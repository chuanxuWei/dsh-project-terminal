/** Project environment loading, validation, and conventional Action discovery. */

import { createHash } from 'node:crypto'
import { lstat, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { CheckoutKind, ProjectAction, ProjectActionKind } from './types.js'

type PlatformCommand = {
  readonly command?: unknown
  readonly darwin?: unknown
  readonly linux?: unknown
  readonly win32?: unknown
}

/** Normalized setup configuration for one project checkout. */
export interface ProjectSetupConfig {
  readonly command: string
  readonly autoRunOnWorktree: boolean
  readonly digest: string
}

/** Normalized environment configuration loaded for one checkout. */
export interface ProjectEnvironment {
  readonly actions: readonly ProjectAction[]
  readonly setup?: ProjectSetupConfig
}

interface CacheEntry {
  readonly key: string
  readonly value: ProjectEnvironment
}

const ACTION_ID = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/
const ACTION_KINDS = new Set<ProjectActionKind>(['run', 'test', 'lint', 'dev', 'build', 'custom'])

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function commandOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function platformCommand(value: unknown, label: string): string {
  if (typeof value === 'string') return commandOf(value, label)
  const input = record(value, label) as PlatformCommand
  const selected = input[process.platform as keyof PlatformCommand] ?? input.command
  return commandOf(selected, `${label}.${process.platform}`)
}

function parseAction(value: unknown, index: number): ProjectAction {
  const input = record(value, `actions[${String(index)}]`)
  const id = commandOf(input.id, `actions[${String(index)}].id`)
  if (!ACTION_ID.test(id)) throw new Error(`actions[${String(index)}].id must be a lowercase action id`)
  const label = commandOf(input.label, `actions[${String(index)}].label`)
  const kind = input.kind === undefined ? 'custom' : commandOf(input.kind, `actions[${String(index)}].kind`)
  if (!ACTION_KINDS.has(kind as ProjectActionKind)) throw new Error(`actions[${String(index)}].kind is unsupported`)
  return {
    id,
    label,
    kind: kind as ProjectActionKind,
    command: platformCommand(input, `actions[${String(index)}]`),
  }
}

function parseSetup(value: unknown): ProjectSetupConfig | undefined {
  if (value === undefined) return undefined
  const input = record(value, 'setup')
  const command = platformCommand(input, 'setup')
  if (input.autoRunOnWorktree !== undefined && typeof input.autoRunOnWorktree !== 'boolean') {
    throw new Error('setup.autoRunOnWorktree must be a boolean')
  }
  return {
    command,
    autoRunOnWorktree: input.autoRunOnWorktree === true,
    digest: createHash('sha256').update(`${process.platform}\0${command}`).digest('hex'),
  }
}

function packageManager(files: ReadonlySet<string>): string {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun'
  return 'npm'
}

function scriptCommand(manager: string, script: string): string {
  if (manager === 'yarn') return `yarn ${script}`
  if (manager === 'bun') return `bun run ${script}`
  return `${manager} run ${script}`
}

async function conventionalActions(cwd: string): Promise<ProjectAction[]> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const input = record(manifest, 'package.json')
  const scripts = input.scripts === undefined ? {} : record(input.scripts, 'package.json scripts')
  const fileNames = new Set<string>()
  for (const name of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json']) {
    try {
      await stat(join(cwd, name))
      fileNames.add(name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const manager = packageManager(fileNames)
  const candidates: readonly { id: string; label: string; kind: ProjectActionKind; scripts: readonly string[] }[] = [
    { id: 'run', label: 'Run', kind: 'run', scripts: ['start', 'run'] },
    { id: 'test', label: 'Test', kind: 'test', scripts: ['test'] },
    { id: 'lint', label: 'Lint', kind: 'lint', scripts: ['lint'] },
    { id: 'dev', label: 'Dev', kind: 'dev', scripts: ['dev'] },
    { id: 'build', label: 'Build', kind: 'build', scripts: ['build'] },
  ]
  return candidates.flatMap((candidate) => {
    const script = candidate.scripts.find(name => typeof scripts[name] === 'string')
    return script === undefined ? [] : [{
      id: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      command: scriptCommand(manager, script),
    }]
  })
}

/** Load one checkout's optional shared file, falling back to package scripts for Actions. */
export class ProjectEnvironmentLoader {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly filename: string) {}

  async load(cwd: string): Promise<ProjectEnvironment> {
    const path = join(cwd, this.filename)
    let source: string | undefined
    let key = 'absent'
    try {
      const info = await stat(path)
      key = `${String(info.mtimeMs)}:${String(info.size)}`
      const cached = this.cache.get(cwd)
      if (cached?.key === key) return cached.value
      source = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parsed = source === undefined ? undefined : record(JSON.parse(source) as unknown, this.filename)
    if (parsed?.version !== undefined && parsed.version !== 1) throw new Error(`${this.filename} version must be 1`)
    let actions: readonly ProjectAction[]
    if (parsed?.actions === undefined) {
      actions = await conventionalActions(cwd)
    } else {
      if (!Array.isArray(parsed.actions)) throw new Error('actions must be an array')
      if (parsed.actions.length > 16) throw new Error('actions supports at most 16 entries')
      actions = parsed.actions.map(parseAction)
      const ids = new Set(actions.map(action => action.id))
      if (ids.size !== actions.length) throw new Error('actions ids must be unique')
    }
    const setup = parseSetup(parsed?.setup)
    const value: ProjectEnvironment = {
      actions,
      ...setup === undefined ? {} : { setup },
    }
    this.cache.set(cwd, { key, value })
    return value
  }

  invalidate(cwd: string): void {
    this.cache.delete(cwd)
  }
}

/** Classify the checkout without invoking Git or mutating repository state. */
export async function checkoutKind(cwd: string): Promise<CheckoutKind> {
  try {
    const info = await lstat(join(cwd, '.git'))
    if (info.isFile()) return 'linked-worktree'
    if (info.isDirectory()) return 'primary-checkout'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return 'directory'
}

/** Human-facing project label from an absolute checkout path. */
export function projectName(cwd: string): string {
  return basename(cwd) || cwd
}
