import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
} from '@deepseek-ai/dsh-subprocess'
import { HumanTerminal } from '../src/terminal.js'

class FakeTerminalHandle implements SubprocessTerminalHandle {
  readonly pid = 4100
  readonly output = new PassThrough()
  readonly writes: string[] = []
  readonly done: Promise<SubprocessOutcome>
  private readonly settled = Promise.withResolvers<SubprocessOutcome>()

  constructor() {
    this.done = this.settled.promise
  }

  async write(data: string): Promise<void> {
    this.writes.push(data)
  }

  async inspectForeground(): Promise<SubprocessTerminalForeground> {
    return { processGroupId: 4200, inputWaiting: false }
  }

  async signalForeground(_signal: SubprocessTerminalSignal): Promise<number> {
    return 4200
  }

  async terminate(): Promise<void> {
    this.settled.resolve({ exitCode: 0, signal: null })
  }
}

describe('human terminal', () => {
  it('retains output, tracks Action completion, and discovers development ports', async () => {
    const handle = new FakeTerminalHandle()
    const terminal = new HumanTerminal('session-one', '/repo', handle, 64 * 1024)
    handle.output.write('ready at http://localhost:4312/\r\n')
    const run = await terminal.run({ actionId: 'test', label: 'Test', kind: 'test', command: 'pnpm test' })
    expect(handle.writes[0]).toContain('pnpm test')
    expect(handle.writes[0]).toContain('\\033]777;DSH_ACTION;')
    expect(handle.writes[0]).not.toMatch(/[\u001b\u0007]/)
    expect(terminal.action()).toMatchObject({ status: 'running', label: 'Test' })

    handle.output.write(`done\r\n\u001b]777;DSH_ACTION;${run.id};0\u0007`)
    await new Promise(resolve => setImmediate(resolve))
    expect(terminal.action()).toMatchObject({ status: 'succeeded', exitCode: 0 })
    expect(terminal.read(0)).toMatchObject({ truncated: false })
    expect(terminal.read(0).output).toContain('ready at')
    await expect(terminal.portSnapshots()).resolves.toEqual([{ port: 4312, url: 'http://localhost:4312', listening: false }])
    await expect(terminal.process()).resolves.toMatchObject({ pid: 4100, status: 'running', foreground: { processGroupId: 4200 } })
  })

  it('rejects a second Action until the first marker arrives', async () => {
    const terminal = new HumanTerminal('session-two', '/repo', new FakeTerminalHandle(), 64 * 1024)
    await terminal.run({ actionId: 'dev', label: 'Dev', kind: 'dev', command: 'pnpm dev' })
    await expect(terminal.run({ actionId: 'test', label: 'Test', kind: 'test', command: 'pnpm test' }))
      .rejects.toThrow('is still running')
  })

  it('settles a running Action when its shell exits before emitting a marker', async () => {
    const handle = new FakeTerminalHandle()
    const terminal = new HumanTerminal('session-three', '/repo', handle, 64 * 1024)
    await terminal.run({ actionId: 'build', label: 'Build', kind: 'build', command: 'exec build' })
    await handle.terminate()
    await new Promise(resolve => setImmediate(resolve))
    expect(terminal.action()).toMatchObject({ status: 'succeeded', exitCode: 0 })
    await expect(terminal.process()).resolves.toMatchObject({ status: 'exited' })
  })
})
