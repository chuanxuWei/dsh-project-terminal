/** Narrow DSH rc.8 browser contracts used by the standalone client bundle. */

import type {
  ProjectTerminalOpenResult,
  ProjectTerminalReadResult,
  ProjectTerminalSnapshot,
} from '../types.js'

export type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string

export interface FooterActionRuntime {
  readonly wide: boolean
}

export interface ClientRpcResult {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

export interface ProjectTerminalRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<ClientRpcResult>
}

export interface SessionListSnapshot {
  readonly current?: string
  readonly byId: Readonly<Record<string, { readonly id: string; readonly cwd?: string } | undefined>>
}

export interface SessionListObservable {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
}

export interface ProjectTerminalClientContext {
  readonly locale: {
    register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): void | (() => void)
    bind(namespace: string): Translate
  }
  readonly sessions: { readonly list: SessionListObservable }
  readonly slots: {
    inject(name: 'sidebar.footer.action', setup: () => void | (() => void)): void | (() => void)
    register(options: {
      readonly name: 'sidebar.footer.action'
      readonly id: string
      readonly order: number
      readonly label: () => string
      readonly locale: string
      readonly inject: () => ProjectTerminalInjected
    }, component: unknown): void | (() => void)
  }
  readonly connection: { readonly rpc: ProjectTerminalRpc }
  get(name: 'connection'): { readonly rpc: ProjectTerminalRpc }
  effect(setup: () => void | (() => void), label?: string): void
}

export interface ProjectTerminalApi {
  state(sessionId: string, signal?: AbortSignal): Promise<ProjectTerminalSnapshot>
  open(sessionId: string, rows: number, cols: number, signal?: AbortSignal): Promise<ProjectTerminalOpenResult>
  read(sessionId: string, cursor: number, signal?: AbortSignal): Promise<ProjectTerminalReadResult>
  write(sessionId: string, data: string): Promise<void>
  runAction(sessionId: string, actionId: string): Promise<void>
  runSetup(sessionId: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  close(sessionId: string): Promise<void>
  refresh(sessionId: string): Promise<ProjectTerminalSnapshot>
}

/** Browser callbacks and observable injected into the footer component. */
export interface ProjectTerminalInjected {
  readonly api: ProjectTerminalApi
  readonly sessionList: SessionListObservable
}
