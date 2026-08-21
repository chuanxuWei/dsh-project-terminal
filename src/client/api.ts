/** Typed client over DSH Connection's loopback project-terminal channel. */

import type {
  ProjectTerminalOpenResult,
  ProjectTerminalReadResult,
  ProjectTerminalSnapshot,
} from '../types.js'
import type { ClientRpcResult, ProjectTerminalApi, ProjectTerminalRpc } from './contracts.js'

function valueOf<T>(result: ClientRpcResult): T {
  if (!result.ok) throw new Error(result.error?.message ?? 'Project Terminal request failed')
  return result.value as T
}

/** Connection-backed Project Terminal API. */
export class ConnectionProjectTerminalApi implements ProjectTerminalApi {
  constructor(private readonly rpc: ProjectTerminalRpc) {}

  private async call<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    return valueOf<T>(await this.rpc.call('/project-terminal', endpoint, payload, signal))
  }

  state(sessionId: string, signal?: AbortSignal): Promise<ProjectTerminalSnapshot> {
    return this.call('state', { sessionId }, signal)
  }

  open(sessionId: string, rows: number, cols: number, signal?: AbortSignal): Promise<ProjectTerminalOpenResult> {
    return this.call('open', { sessionId, rows, cols }, signal)
  }

  read(sessionId: string, cursor: number, signal?: AbortSignal): Promise<ProjectTerminalReadResult> {
    return this.call('read', { sessionId, cursor }, signal)
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.call('write', { sessionId, data })
  }

  async runAction(sessionId: string, actionId: string): Promise<void> {
    await this.call('action', { sessionId, actionId })
  }

  async runSetup(sessionId: string): Promise<void> {
    await this.call('setup', { sessionId })
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.call('interrupt', { sessionId })
  }

  async close(sessionId: string): Promise<void> {
    await this.call('close', { sessionId })
  }

  refresh(sessionId: string): Promise<ProjectTerminalSnapshot> {
    return this.call('refresh', { sessionId })
  }
}
