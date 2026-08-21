import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
} from '@deepseek-ai/dsh-subprocess'
import { ProjectTerminalService, resolveOptions } from '../src/service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FakeTerminalHandle implements SubprocessTerminalHandle {
  readonly pid = 5100
  readonly output = new PassThrough()
  readonly writes: string[] = []
  readonly done: Promise<SubprocessOutcome>
  private readonly settled = Promise.withResolvers<SubprocessOutcome>()

  constructor() {
    this.done = this.settled.promise
  }

  async write(data: string): Promise<void> { this.writes.push(data) }
  async inspectForeground(): Promise<SubprocessTerminalForeground> { return { processGroupId: 5100, inputWaiting: true } }
  async signalForeground(_signal: SubprocessTerminalSignal): Promise<number> { return 5100 }
  async terminate(): Promise<void> { this.settled.resolve({ exitCode: 0, signal: null }) }
}

describe('project terminal service', () => {
  it('automatically starts an opted-in setup command for a newly created linked worktree Session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-terminal-service-'))
    roots.push(root)
    await writeFile(join(root, '.git'), 'gitdir: /tmp/source/.git/worktrees/fixture\n', 'utf8')
    await mkdir(join(root, '.dsh'))
    await writeFile(join(root, '.dsh/environment.json'), JSON.stringify({
      version: 1,
      setup: { command: 'printf setup-ok', autoRunOnWorktree: true },
    }), 'utf8')

    const handle = new FakeTerminalHandle()
    const ctx = {
      sessions: { get: () => ({ header: { cwd: root } }) },
      sessionPersistence: { inspect: async () => ({ meta: { cwd: root } }) },
      subprocess: { spawnTerminal: async () => handle },
    }
    const service = new ProjectTerminalService(ctx as never, resolveOptions({
      setupStatePath: join(root, '.state/setup.json'),
    }))
    await service.start()
    await service.autoSetupCreatedSession('session-worktree', root)

    expect(handle.writes).toHaveLength(1)
    expect(handle.writes[0]).toContain('printf setup-ok')
    expect((await service.state('session-worktree')).setup.status).toBe('running')
    handle.output.write('setup output visible to Agent\n')
    await new Promise(resolve => setImmediate(resolve))
    await expect(service.readForAgent({ id: 'session-worktree' } as never, 10)).resolves.toMatchObject({
      available: true,
      output: expect.stringContaining('setup output visible to Agent'),
    })
    await expect(service.readForAgent({ id: 'another-session' } as never, 10)).resolves.toMatchObject({
      available: false,
    })
    await service.dispose()
  })
})
