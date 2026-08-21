/** Loopback RPC surface reserved for explicit browser terminal operations. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { ProjectTerminalService } from './service.js'

export type ProjectTerminalRpcResult = RpcResult<unknown>

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('payload must be an object')
  return value as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = input[key]
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw new Error(`${key} must be a string${allowEmpty ? '' : ' with content'}`)
  return value
}

function integerField(input: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = input[key]
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} must be an integer from ${String(minimum)} to ${String(maximum)}`)
  }
  return value as number
}

function failure(error: unknown): ProjectTerminalRpcResult {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: `project-terminal: ${error instanceof Error ? error.message : String(error)}`,
      details: {},
    },
  }
}

/** Build the `/project-terminal` dispatcher. */
export function createProjectTerminalRpcHandler(service: ProjectTerminalService) {
  return async (endpoint: string, payload: unknown, _signal: AbortSignal): Promise<ProjectTerminalRpcResult> => {
    try {
      const input = record(payload)
      const sessionId = stringField(input, 'sessionId')
      switch (endpoint) {
        case 'state':
          return { ok: true, value: await service.state(sessionId) }
        case 'open':
          return {
            ok: true,
            value: await service.open(
              sessionId,
              integerField(input, 'rows', 10, 200),
              integerField(input, 'cols', 40, 400),
            ),
          }
        case 'read':
          return { ok: true, value: await service.read(sessionId, integerField(input, 'cursor', 0, Number.MAX_SAFE_INTEGER)) }
        case 'write':
          await service.write(sessionId, stringField(input, 'data', true))
          return { ok: true, value: {} }
        case 'action':
          await service.runAction(sessionId, stringField(input, 'actionId'))
          return { ok: true, value: {} }
        case 'setup':
          await service.runSetup(sessionId)
          return { ok: true, value: {} }
        case 'interrupt':
          return { ok: true, value: { processGroupId: await service.interrupt(sessionId) } }
        case 'close':
          await service.close(sessionId)
          return { ok: true, value: {} }
        case 'refresh':
          return { ok: true, value: await service.refresh(sessionId) }
        default:
          throw new Error(`unknown endpoint ${JSON.stringify(endpoint)}`)
      }
    } catch (error) {
      return failure(error)
    }
  }
}
