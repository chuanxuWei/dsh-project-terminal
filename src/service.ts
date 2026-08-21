/** Host coordinator for authoritative Session checkout resolution and human PTYs. */

import { isAbsolute, normalize, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { checkoutKind, ProjectEnvironmentLoader, projectName } from './environment.js'
import type { ProjectEnvironment, ProjectSetupConfig } from './environment.js'
import { SetupStateStore } from './setup-store.js'
import { HumanTerminal } from './terminal.js'
import type {
  AgentTerminalReadResult,
  ProjectSetupSnapshot,
  ProjectTerminalOpenResult,
  ProjectTerminalReadResult,
  ProjectTerminalSnapshot,
} from './types.js'

interface ProjectTerminalContext extends Context {
  readonly subprocess: SubprocessRuntime
  readonly sessionPersistence: SessionPersistence
}

/** Validated deployment configuration used by the terminal coordinator. */
export interface ProjectTerminalOptions {
  readonly setupStatePath: string
  readonly environmentFile: string
  readonly maxTerminals: number
  readonly maxScrollbackBytes: number
  readonly shellGraceMs: number
  readonly agentReadMaxLines: number
}

function defaultShell(): readonly string[] {
  if (process.platform === 'win32') return [process.env.ComSpec ?? 'powershell.exe']
  return [process.env.SHELL ?? '/bin/sh', '-l']
}

function lineTail(text: string, lines: number): { output: string; truncated: boolean } {
  const clean = stripVTControlCharacters(text).replace(/\r(?!\n)/g, '\n')
  const rows = clean.split('\n')
  if (rows.length <= lines) return { output: clean, truncated: false }
  return { output: rows.slice(-lines).join('\n'), truncated: true }
}

/** Owns human terminals separately from DSH's Agent-scoped PTY registry. */
export class ProjectTerminalService {
  private readonly terminals = new Map<string, HumanTerminal>()
  private readonly environments: ProjectEnvironmentLoader
  private readonly setupState: SetupStateStore

  constructor(
    private readonly ctx: ProjectTerminalContext,
    private readonly options: ProjectTerminalOptions,
  ) {
    this.environments = new ProjectEnvironmentLoader(options.environmentFile)
    this.setupState = new SetupStateStore(options.setupStatePath)
  }

  async start(): Promise<void> {
    await this.setupState.load()
  }

  async state(sessionId: string): Promise<ProjectTerminalSnapshot> {
    const cwd = await this.resolveCwd(sessionId)
    return await this.snapshot(sessionId, cwd, this.terminals.get(sessionId))
  }

  async open(sessionId: string, rows: number, cols: number): Promise<ProjectTerminalOpenResult> {
    const cwd = await this.resolveCwd(sessionId)
    let terminal = this.terminals.get(sessionId)
    if (terminal === undefined) {
      if (this.terminals.size >= this.options.maxTerminals) {
        throw new Error(`the ${String(this.options.maxTerminals)} terminal limit is reached; close one before opening another`)
      }
      const handle = await this.ctx.subprocess.spawnTerminal({
        argv: defaultShell(),
        cwd,
        env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', DSH_HUMAN_TERMINAL: '1' },
        rows,
        cols,
        graceMs: this.options.shellGraceMs,
      })
      terminal = new HumanTerminal(sessionId, cwd, handle, this.options.maxScrollbackBytes)
      this.terminals.set(sessionId, terminal)
    } else if (terminal.cwd !== cwd) {
      throw new Error(`session ${JSON.stringify(sessionId)} changed checkout while its terminal is live`)
    }
    await this.maybeAutoSetup(sessionId, cwd, terminal)
    const retained = terminal.tail()
    return {
      ...await this.snapshot(sessionId, cwd, terminal),
      output: retained.output,
      truncated: retained.truncated,
    }
  }

  async read(sessionId: string, cursor: number): Promise<ProjectTerminalReadResult> {
    await this.resolveCwd(sessionId)
    const terminal = this.requireTerminal(sessionId)
    const delta = terminal.read(cursor)
    const action = terminal.action()
    return {
      ...delta,
      process: await terminal.process(),
      ...action === undefined ? {} : { action },
      ports: await terminal.portSnapshots(),
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.resolveCwd(sessionId)
    if (Buffer.byteLength(data) > 64 * 1024) throw new Error('terminal input exceeds 64 KiB')
    await this.requireTerminal(sessionId).write(data)
  }

  async runAction(sessionId: string, actionId: string): Promise<void> {
    const cwd = await this.resolveCwd(sessionId)
    const environment = await this.environments.load(cwd)
    const action = environment.actions.find(candidate => candidate.id === actionId)
    if (action === undefined) throw new Error(`unknown project action ${JSON.stringify(actionId)}`)
    await this.requireTerminal(sessionId).run({
      actionId: action.id,
      label: action.label,
      kind: action.kind,
      command: action.command,
    })
  }

  async runSetup(sessionId: string): Promise<void> {
    const cwd = await this.resolveCwd(sessionId)
    const environment = await this.environments.load(cwd)
    if (environment.setup === undefined) throw new Error('this project has no setup command')
    await this.startSetup(cwd, this.requireTerminal(sessionId), environment.setup)
  }

  async interrupt(sessionId: string): Promise<number> {
    await this.resolveCwd(sessionId)
    return await this.requireTerminal(sessionId).interrupt()
  }

  async close(sessionId: string): Promise<void> {
    await this.resolveCwd(sessionId)
    const terminal = this.requireTerminal(sessionId)
    await terminal.close()
    this.terminals.delete(sessionId)
  }

  async refresh(sessionId: string): Promise<ProjectTerminalSnapshot> {
    const cwd = await this.resolveCwd(sessionId)
    this.environments.invalidate(cwd)
    return await this.snapshot(sessionId, cwd, this.terminals.get(sessionId))
  }

  async autoSetupCreatedSession(sessionId: string, cwd: string | undefined): Promise<void> {
    if (cwd === undefined || await checkoutKind(cwd) !== 'linked-worktree') return
    const environment = await this.environments.load(cwd)
    if (environment.setup?.autoRunOnWorktree !== true || this.setupState.has(cwd, environment.setup.digest)) return
    const opened = await this.open(sessionId, 30, 120)
    if (opened.setup.status === 'ready') await this.runSetup(sessionId)
  }

  async readForAgent(agent: Agent, lines = this.options.agentReadMaxLines): Promise<AgentTerminalReadResult> {
    const terminal = this.terminals.get(String(agent.id))
    if (terminal === undefined) return { available: false, ports: [], output: 'No human terminal is open for this Session.', truncated: false }
    const retained = terminal.tail()
    const bounded = lineTail(retained.output, lines)
    const process = await terminal.process()
    const action = terminal.action()
    const ports = await terminal.portSnapshots()
    return {
      available: true,
      cwd: terminal.cwd,
      pid: terminal.pid,
      status: process.status,
      ...action === undefined ? {} : { action: `${action.label}: ${action.status}` },
      ports: ports.filter(port => port.listening).map(port => port.port),
      output: bounded.output,
      truncated: retained.truncated || bounded.truncated,
    }
  }

  async dispose(): Promise<void> {
    const terminals = [...this.terminals.values()]
    this.terminals.clear()
    const results = await Promise.allSettled(terminals.map(terminal => terminal.close()))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
    if (failures.length > 0) throw new AggregateError(failures, 'one or more human terminals failed to close')
  }

  private requireTerminal(sessionId: string): HumanTerminal {
    const terminal = this.terminals.get(sessionId)
    if (terminal === undefined) throw new Error('the Session terminal is not open')
    return terminal
  }

  private async resolveCwd(sessionId: string): Promise<string> {
    if (sessionId.length === 0) throw new Error('sessionId must be non-empty')
    const id = SessionId(sessionId)
    const live = this.ctx.sessions.get(id)
    const cwd = live?.header.cwd ?? (await this.ctx.sessionPersistence.inspect(id)).meta.cwd
    if (cwd === undefined) throw new Error(`session ${JSON.stringify(sessionId)} has no project checkout`)
    return cwd
  }

  private async maybeAutoSetup(sessionId: string, cwd: string, terminal: HumanTerminal): Promise<void> {
    if (terminal.action()?.status === 'running') return
    const environment = await this.environments.load(cwd)
    const setup = environment.setup
    if (setup?.autoRunOnWorktree !== true) return
    if (await checkoutKind(cwd) !== 'linked-worktree' || this.setupState.has(cwd, setup.digest)) return
    await this.startSetup(cwd, terminal, setup)
  }

  private async startSetup(cwd: string, terminal: HumanTerminal, setup: ProjectSetupConfig): Promise<void> {
    await terminal.run({
      actionId: 'setup',
      label: 'Setup',
      kind: 'setup',
      command: setup.command,
      onComplete: async (exitCode) => {
        if (exitCode === 0) await this.setupState.mark(cwd, setup.digest)
      },
    })
  }

  private setupSnapshot(cwd: string, environment: ProjectEnvironment, terminal: HumanTerminal | undefined): ProjectSetupSnapshot {
    const setup = environment.setup
    if (setup === undefined) return { configured: false, autoRunOnWorktree: false, status: 'not-configured' }
    const run = terminal?.action()
    if (run?.kind === 'setup') {
      return {
        configured: true,
        autoRunOnWorktree: setup.autoRunOnWorktree,
        status: run.status === 'running' ? 'running' : run.status,
        ...run.exitCode === undefined ? {} : { lastExitCode: run.exitCode },
      }
    }
    return {
      configured: true,
      autoRunOnWorktree: setup.autoRunOnWorktree,
      status: this.setupState.has(cwd, setup.digest) ? 'succeeded' : 'ready',
    }
  }

  private async snapshot(sessionId: string, cwd: string, terminal: HumanTerminal | undefined): Promise<ProjectTerminalSnapshot> {
    const environment = await this.environments.load(cwd)
    const action = terminal?.action()
    return {
      sessionId,
      cwd,
      projectName: projectName(cwd),
      checkout: await checkoutKind(cwd),
      actions: environment.actions,
      setup: this.setupSnapshot(cwd, environment, terminal),
      ...terminal === undefined ? {} : {
        terminal: {
          cursor: terminal.read(Number.MAX_SAFE_INTEGER).cursor,
          process: await terminal.process(),
          ...action === undefined ? {} : { action },
          ports: await terminal.portSnapshots(),
        },
      },
    }
  }
}

/** Validate plugin paths and numeric limits before any process is spawned. */
export function resolveOptions(config: Record<string, unknown>): ProjectTerminalOptions {
  const setupStatePath = config.setupStatePath
  if (typeof setupStatePath !== 'string' || !isAbsolute(setupStatePath)) throw new Error('dsh-project-terminal: setupStatePath must be absolute')
  const environmentFile = config.environmentFile ?? '.dsh/environment.json'
  if (typeof environmentFile !== 'string' || environmentFile.length === 0 || isAbsolute(environmentFile)) {
    throw new Error('dsh-project-terminal: environmentFile must be a relative path')
  }
  const normalizedEnvironment = normalize(environmentFile)
  if (normalizedEnvironment === '..' || normalizedEnvironment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('dsh-project-terminal: environmentFile must stay inside the checkout')
  }
  const integer = (name: string, fallback: number, minimum: number, maximum: number): number => {
    const value = config[name] ?? fallback
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
      throw new Error(`dsh-project-terminal: ${name} must be an integer from ${String(minimum)} to ${String(maximum)}`)
    }
    return value as number
  }
  return {
    setupStatePath: resolve(setupStatePath),
    environmentFile: normalizedEnvironment,
    maxTerminals: integer('maxTerminals', 8, 1, 64),
    maxScrollbackBytes: integer('maxScrollbackBytes', 1024 * 1024, 64 * 1024, 16 * 1024 * 1024),
    shellGraceMs: integer('shellGraceMs', 3000, 100, 30_000),
    agentReadMaxLines: integer('agentReadMaxLines', 120, 10, 1000),
  }
}
