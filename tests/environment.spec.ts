import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkoutKind, ProjectEnvironmentLoader } from '../src/environment.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-terminal-environment-'))
  roots.push(root)
  return root
}

describe('project environment', () => {
  it('discovers conventional package Actions with the checkout package manager', async () => {
    const root = await temporary()
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node app.js', test: 'vitest', dev: 'vite' } }), 'utf8')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
    await expect(new ProjectEnvironmentLoader('.dsh/environment.json').load(root)).resolves.toMatchObject({
      actions: [
        { id: 'run', command: 'pnpm run start' },
        { id: 'test', command: 'pnpm run test' },
        { id: 'dev', command: 'pnpm run dev' },
      ],
    })
  })

  it('uses platform commands and rejects duplicate explicit Action ids', async () => {
    const root = await temporary()
    await mkdir(join(root, '.dsh'))
    const platformCommand = process.platform === 'win32' ? 'Write-Host ok' : 'printf ok'
    await writeFile(join(root, '.dsh/environment.json'), JSON.stringify({
      version: 1,
      setup: { command: 'fallback', [process.platform]: platformCommand, autoRunOnWorktree: true },
      actions: [
        { id: 'check', label: 'Check', kind: 'test', command: 'fallback', [process.platform]: platformCommand },
      ],
    }), 'utf8')
    await expect(new ProjectEnvironmentLoader('.dsh/environment.json').load(root)).resolves.toMatchObject({
      setup: { command: platformCommand, autoRunOnWorktree: true },
      actions: [{ id: 'check', command: platformCommand }],
    })

    await writeFile(join(root, '.dsh/environment.json'), JSON.stringify({
      version: 1,
      actions: [
        { id: 'same', label: 'A', command: 'true' },
        { id: 'same', label: 'B', command: 'true' },
      ],
    }), 'utf8')
    const loader = new ProjectEnvironmentLoader('.dsh/environment.json')
    await expect(loader.load(root)).rejects.toThrow('actions ids must be unique')
  })

  it('distinguishes a linked Worktree from a primary checkout and plain directory', async () => {
    const root = await temporary()
    await expect(checkoutKind(root)).resolves.toBe('directory')
    await mkdir(join(root, '.git'))
    await expect(checkoutKind(root)).resolves.toBe('primary-checkout')
    await rm(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.git'), 'gitdir: /tmp/example\n', 'utf8')
    await expect(checkoutKind(root)).resolves.toBe('linked-worktree')
  })
})
