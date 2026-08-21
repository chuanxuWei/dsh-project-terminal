/** Session-scoped human terminal and project Actions for DeepSeek Harness. */

import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import { createProjectTerminalRpcHandler } from './rpc.js'
import { ProjectTerminalService, resolveOptions } from './service.js'
import { registerProjectTerminalReadTool } from './tool.js'

export type * from './types.js'
export { ProjectEnvironmentLoader, checkoutKind } from './environment.js'
export { SetupStateStore } from './setup-store.js'
export { HumanTerminal } from './terminal.js'
export { ProjectTerminalService, resolveOptions } from './service.js'
export { createProjectTerminalRpcHandler } from './rpc.js'

/** Cordis plugin name. */
export const name = 'project-terminal'

/** Host services required for PTY allocation, Session authority, model reads, and browser RPC. */
export const inject = ['subprocess', 'sessions', 'sessionPersistence', 'tools', 'connection']

/** Deployment-owned persistence, limits, and checkout-local environment filename. */
export interface Config {
  readonly setupStatePath: string
  readonly environmentFile?: string
  readonly maxTerminals?: number
  readonly maxScrollbackBytes?: number
  readonly shellGraceMs?: number
  readonly agentReadMaxLines?: number
}

interface ProjectTerminalContext extends Context {
  readonly connection: HostConnectionHandle
}

/** Mount the separate human PTY registry, loopback browser RPC, and read-only Agent tool. */
export async function apply(ctx: ProjectTerminalContext, config: Config): Promise<void> {
  const options = resolveOptions(config as unknown as Record<string, unknown>)
  const service = new ProjectTerminalService(ctx as never, options)
  await service.start()
  registerProjectTerminalReadTool(ctx, service, options.agentReadMaxLines)
  const disposeRpc = ctx.connection.rpc.handle(
    '/project-terminal',
    createProjectTerminalRpcHandler(service),
    { authority: 'loopback' },
  )
  ctx.on('session/created', (session: Session) => {
    void service.autoSetupCreatedSession(String(session.id), session.header.cwd).catch((error: unknown) => {
      ctx.logger.warn(`project-terminal setup for ${String(session.id)} failed: ${String(error)}`)
    })
  }, { global: true })
  ctx.effect(() => async () => {
    await disposeRpc()
    await service.dispose()
  }, 'dsh-project-terminal: host lifecycle')
}
