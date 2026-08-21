import { describe, expect, it, vi } from 'vitest'
import { createProjectTerminalRpcHandler } from '../src/rpc.js'
import type { ProjectTerminalService } from '../src/service.js'

function service() {
  return {
    state: vi.fn(async sessionId => ({ sessionId })),
    open: vi.fn(async sessionId => ({ sessionId, output: '' })),
    read: vi.fn(async (_sessionId, cursor) => ({ cursor })),
    write: vi.fn(async () => {}),
    runAction: vi.fn(async () => {}),
    runSetup: vi.fn(async () => {}),
    interrupt: vi.fn(async () => 77),
    close: vi.fn(async () => {}),
    refresh: vi.fn(async sessionId => ({ sessionId })),
  }
}

describe('project terminal RPC', () => {
  it('routes browser operations without accepting a browser-supplied cwd', async () => {
    const api = service()
    const handler = createProjectTerminalRpcHandler(api as unknown as ProjectTerminalService)
    await expect(handler('open', { sessionId: 's1', cwd: '/forged', rows: 30, cols: 120 }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { sessionId: 's1' } })
    expect(api.open).toHaveBeenCalledWith('s1', 30, 120)
    expect(api.open.mock.calls[0]).toHaveLength(3)
  })

  it('bounds terminal input fields and rejects unknown endpoints', async () => {
    const api = service()
    const handler = createProjectTerminalRpcHandler(api as unknown as ProjectTerminalService)
    await expect(handler('read', { sessionId: 's1', cursor: -1 }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
    await expect(handler('unknown', { sessionId: 's1' }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('unknown endpoint') } })
  })
})
