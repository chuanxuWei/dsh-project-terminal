/** Atomic persistence for successful checkout setup digests. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface SetupDatabase {
  readonly version: 1
  readonly completed: Readonly<Record<string, string>>
}

function decode(value: unknown): SetupDatabase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('setup state must be an object')
  const input = value as Record<string, unknown>
  if (input.version !== 1) throw new Error('setup state version must be 1')
  if (typeof input.completed !== 'object' || input.completed === null || Array.isArray(input.completed)) {
    throw new Error('setup state completed must be an object')
  }
  const completed: Record<string, string> = {}
  for (const [cwd, digest] of Object.entries(input.completed as Record<string, unknown>)) {
    if (typeof digest !== 'string' || digest.length === 0) throw new Error('setup state contains an invalid digest')
    completed[cwd] = digest
  }
  return { version: 1, completed }
}

/** Stores the last successful setup digest for each exact checkout path. */
export class SetupStateStore {
  private completed: Record<string, string> = {}

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      this.completed = decode(JSON.parse(await readFile(this.path, 'utf8')) as unknown).completed as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  has(cwd: string, digest: string): boolean {
    return this.completed[cwd] === digest
  }

  async mark(cwd: string, digest: string): Promise<void> {
    this.completed = { ...this.completed, [cwd]: digest }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 1, completed: this.completed }, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}
