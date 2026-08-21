import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SetupStateStore } from '../src/setup-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('setup state', () => {
  it('persists only the exact checkout and setup digest pair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-terminal-setup-'))
    roots.push(root)
    const path = join(root, 'state', 'setup.json')
    const first = new SetupStateStore(path)
    await first.load()
    expect(first.has('/repo/worktree', 'one')).toBe(false)
    await first.mark('/repo/worktree', 'one')

    const restarted = new SetupStateStore(path)
    await restarted.load()
    expect(restarted.has('/repo/worktree', 'one')).toBe(true)
    expect(restarted.has('/repo/worktree', 'two')).toBe(false)
    expect(restarted.has('/repo/other', 'one')).toBe(false)
  })
})
