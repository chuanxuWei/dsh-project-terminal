/** One retained human PTY with Action markers, process inspection, and port discovery. */

import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type {
  ActionRunSnapshot,
  ProjectAction,
  ProjectPortSnapshot,
  ProjectProcessSnapshot,
} from './types.js'

interface Chunk {
  readonly cursor: number
  readonly text: string
  readonly bytes: number
}

interface ActionStart {
  readonly actionId: string
  readonly label: string
  readonly kind: ProjectAction['kind'] | 'setup'
  readonly command: string
  readonly onComplete?: (exitCode: number) => Promise<void> | void
}

class ChunkBuffer {
  private readonly chunks: Chunk[] = []
  private bytes = 0
  private nextCursor = 0

  constructor(private readonly maxBytes: number) {}

  append(text: string): void {
    if (text.length === 0) return
    const bytes = Buffer.byteLength(text)
    this.nextCursor += 1
    this.chunks.push({ cursor: this.nextCursor, text, bytes })
    this.bytes += bytes
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()
      if (removed !== undefined) this.bytes -= removed.bytes
    }
  }

  read(cursor: number): { cursor: number; output: string; truncated: boolean } {
    const first = this.chunks[0]?.cursor ?? this.nextCursor + 1
    const truncated = cursor < first - 1
    const output = this.chunks.filter(chunk => truncated || chunk.cursor > cursor).map(chunk => chunk.text).join('')
    return { cursor: this.nextCursor, output, truncated }
  }

  tail(): { output: string; truncated: boolean } {
    return { output: this.chunks.map(chunk => chunk.text).join(''), truncated: this.chunks[0]?.cursor !== 1 }
  }
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (value: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(180)
    socket.once('connect', () => { finish(true) })
    socket.once('error', () => { finish(false) })
    socket.once('timeout', () => { finish(false) })
  })
}

function actionMarker(nonce: string): string {
  // Feed printable escape sequences through the interactive line editor. Raw
  // ESC/BEL bytes would be interpreted as user keystrokes before the shell
  // gets a chance to execute the marker command.
  return `\\033]777;DSH_ACTION;${nonce};%s\\007`
}

function commandWithMarker(command: string, nonce: string): string {
  if (process.platform === 'win32') {
    return `${command}\r\n$__dshStatus = if ($?) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }; [Console]::Write([char]27 + "]777;DSH_ACTION;${nonce};" + $__dshStatus + [char]7)\r\n`
  }
  const marker = actionMarker(nonce)
  return `${command}\n__dsh_status=$?\nprintf '${marker}' "$__dsh_status"\n`
}

/** A human-owned terminal; writes are exposed only through browser RPC. */
export class HumanTerminal {
  private readonly output: ChunkBuffer
  private readonly decoder = new StringDecoder('utf8')
  private outcome: SubprocessOutcome | undefined
  private markerTail = ''
  private activeRun: (ActionRunSnapshot & { readonly nonce: string; readonly onComplete?: ActionStart['onComplete'] }) | undefined
  private lastRun: ActionRunSnapshot | undefined
  private readonly ports = new Map<number, string>()

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    private readonly handle: SubprocessTerminalHandle,
    maxScrollbackBytes: number,
  ) {
    this.output = new ChunkBuffer(maxScrollbackBytes)
    handle.output.on('data', (chunk: Buffer | string) => {
      this.accept(typeof chunk === 'string' ? chunk : this.decoder.write(chunk))
    })
    void handle.done.then((outcome) => {
      this.outcome = outcome
      this.accept(this.decoder.end())
      this.completeActive(outcome.exitCode ?? 1)
    }).catch((error: unknown) => {
      this.outcome = { exitCode: null, signal: null }
      this.accept(`\r\n[dsh-project-terminal transport failed: ${String(error)}]\r\n`)
      this.completeActive(1)
    })
  }

  get pid(): number {
    return this.handle.pid
  }

  read(cursor: number): { cursor: number; output: string; truncated: boolean } {
    return this.output.read(cursor)
  }

  tail(): { output: string; truncated: boolean } {
    return this.output.tail()
  }

  action(): ActionRunSnapshot | undefined {
    return this.activeRun ?? this.lastRun
  }

  async write(data: string): Promise<void> {
    await this.handle.write(data)
  }

  async run(input: ActionStart): Promise<ActionRunSnapshot> {
    if (this.outcome !== undefined) throw new Error('terminal has exited')
    if (this.activeRun !== undefined) throw new Error(`action ${JSON.stringify(this.activeRun.label)} is still running`)
    const nonce = randomUUID()
    const run: ActionRunSnapshot & { readonly nonce: string; readonly onComplete?: ActionStart['onComplete'] } = {
      id: nonce,
      nonce,
      actionId: input.actionId,
      label: input.label,
      kind: input.kind,
      status: 'running',
      startedAt: new Date().toISOString(),
      ...input.onComplete === undefined ? {} : { onComplete: input.onComplete },
    }
    this.activeRun = run
    await this.handle.write(commandWithMarker(input.command, nonce))
    return run
  }

  async interrupt(): Promise<number> {
    return await this.handle.signalForeground('SIGINT')
  }

  async process(): Promise<ProjectProcessSnapshot> {
    if (this.outcome !== undefined) {
      return {
        pid: this.handle.pid,
        status: 'exited',
        exitCode: this.outcome.exitCode,
        signal: this.outcome.signal,
      }
    }
    let foreground: ProjectProcessSnapshot['foreground']
    try {
      foreground = await this.handle.inspectForeground()
    } catch {
      foreground = undefined
    }
    return {
      pid: this.handle.pid,
      status: 'running',
      ...foreground === undefined ? {} : { foreground },
    }
  }

  async portSnapshots(): Promise<ProjectPortSnapshot[]> {
    const candidates = [...this.ports.entries()].slice(-8)
    const listening = await Promise.all(candidates.map(([port]) => probePort(port)))
    return candidates.map(([port, url], index) => ({ port, url, listening: listening[index] === true }))
  }

  async close(): Promise<void> {
    await this.handle.terminate()
  }

  private accept(text: string): void {
    if (text.length === 0) return
    this.output.append(text)
    this.discoverPorts(text)
    const searchable = this.markerTail + text
    const marker = /\u001b\]777;DSH_ACTION;([0-9a-f-]+);(-?\d+)\u0007/g
    for (const match of searchable.matchAll(marker)) {
      const nonce = match[1]
      const exitCode = Number(match[2])
      if (this.activeRun?.nonce !== nonce || !Number.isSafeInteger(exitCode)) continue
      this.completeActive(exitCode)
    }
    this.markerTail = searchable.slice(-256)
  }

  private completeActive(exitCode: number): void {
    const active = this.activeRun
    if (active === undefined) return
    this.activeRun = undefined
    this.lastRun = {
      id: active.id,
      actionId: active.actionId,
      label: active.label,
      kind: active.kind,
      status: exitCode === 0 ? 'succeeded' : 'failed',
      startedAt: active.startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
    }
    if (active.onComplete !== undefined) {
      void Promise.resolve(active.onComplete(exitCode)).catch((error: unknown) => {
        this.output.append(`\r\n[dsh-project-terminal setup state write failed: ${String(error)}]\r\n`)
      })
    }
  }

  private discoverPorts(text: string): void {
    const urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(?:\/[^\s\u001b]*)?/g
    for (const match of text.matchAll(urlPattern)) {
      const port = Number(match[1])
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) continue
      const scheme = match[0]?.startsWith('https://') === true ? 'https' : 'http'
      this.ports.set(port, `${scheme}://localhost:${String(port)}`)
    }
  }
}
