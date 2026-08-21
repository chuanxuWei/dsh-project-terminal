/** Shared Host/browser data for Project Terminal. */

/** Conventional or project-defined action category. */
export type ProjectActionKind = 'run' | 'test' | 'lint' | 'dev' | 'build' | 'custom'

/** One user-invoked command exposed in the project action rail. */
export interface ProjectAction {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly kind: ProjectActionKind
}

/** Git checkout classification used by setup policy and the browser badge. */
export type CheckoutKind = 'linked-worktree' | 'primary-checkout' | 'directory'

/** Setup state for the current checkout. */
export interface ProjectSetupSnapshot {
  readonly configured: boolean
  readonly autoRunOnWorktree: boolean
  readonly status: 'not-configured' | 'ready' | 'running' | 'succeeded' | 'failed'
  readonly lastExitCode?: number
}

/** A user-started project Action and its latest state. */
export interface ActionRunSnapshot {
  readonly id: string
  readonly actionId: string
  readonly label: string
  readonly kind: ProjectActionKind | 'setup'
  readonly status: 'running' | 'succeeded' | 'failed'
  readonly startedAt: string
  readonly finishedAt?: string
  readonly exitCode?: number
}

/** Port inferred from terminal output and actively probed on loopback. */
export interface ProjectPortSnapshot {
  readonly port: number
  readonly url: string
  readonly listening: boolean
}

/** Live PTY process state visible to the user. */
export interface ProjectProcessSnapshot {
  readonly pid: number
  readonly status: 'running' | 'exited'
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly foreground?: {
    readonly processGroupId: number
    readonly inputWaiting: boolean
  }
}

/** Authoritative project and terminal state returned by loopback RPC. */
export interface ProjectTerminalSnapshot {
  readonly sessionId: string
  readonly cwd: string
  readonly projectName: string
  readonly checkout: CheckoutKind
  readonly actions: readonly ProjectAction[]
  readonly setup: ProjectSetupSnapshot
  readonly terminal?: {
    readonly cursor: number
    readonly process: ProjectProcessSnapshot
    readonly action?: ActionRunSnapshot
    readonly ports: readonly ProjectPortSnapshot[]
  }
}

/** Initial/open response including retained terminal bytes. */
export interface ProjectTerminalOpenResult extends ProjectTerminalSnapshot {
  readonly output: string
  readonly truncated: boolean
}

/** Incremental terminal read result. */
export interface ProjectTerminalReadResult {
  readonly cursor: number
  readonly output: string
  readonly truncated: boolean
  readonly process: ProjectProcessSnapshot
  readonly action?: ActionRunSnapshot
  readonly ports: readonly ProjectPortSnapshot[]
}

/** Read-only model tool result; there is deliberately no matching write tool. */
export interface AgentTerminalReadResult {
  readonly available: boolean
  readonly cwd?: string
  readonly pid?: number
  readonly status?: 'running' | 'exited'
  readonly action?: string
  readonly ports: number[]
  readonly output: string
  readonly truncated: boolean
}
