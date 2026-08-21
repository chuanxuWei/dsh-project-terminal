import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const required = [
  'lib/index.js',
  'lib/client.js',
  'lib/client.js.map',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'cordis.patch.yml',
  'README.md',
  'README.zh.md',
  'CHANGELOG.md',
  'LICENSE',
  'docs/architecture.md',
  'docs/manual-verification.md',
]

await Promise.all(required.map(path => access(new URL(path, root))))

const host = await readFile(new URL('lib/index.js', root), 'utf8')
if (!/authority:\s*["']loopback["']/.test(host)) throw new Error('Host bundle is missing loopback-only RPC authority')
if (!host.includes('project_terminal_read')) throw new Error('Host bundle is missing the read-only Agent tool')
if (host.includes("name: 'project_terminal_write'") || host.includes('name: "project_terminal_write"')) {
  throw new Error('Host bundle unexpectedly exposes a model terminal write tool')
}
if (!host.includes('spawnTerminal')) throw new Error('Host bundle is missing the DSH subprocess PTY seam')

const client = await readFile(new URL('lib/client.js', root), 'utf8')
if (!/window\.__ModuleLoader__\.load\(\{\s*id:\s*["']dsh-project-terminal["']/.test(client)) {
  throw new Error('client bundle is missing the DSH ModuleLoader factory wrapper')
}
if (!client.includes('sidebar.footer.action')) throw new Error('client bundle does not register sidebar.footer.action')
if (!client.includes('data-plugin-css')) throw new Error('client bundle is missing lifecycle-owned CSS injection')
if (!client.includes('project-terminal')) throw new Error('client bundle is missing the project-terminal channel')
if (client.includes('@deepseek-ai/')) throw new Error('client bundle contains a DSH runtime package import')

const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('manifest is missing the DSH bundle patch')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('manifest is missing the Web client declaration')
const expectedInject = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-sidebar',
]
if (JSON.stringify(manifest.dsh?.client?.inject) !== JSON.stringify(expectedInject)) {
  throw new Error('manifest has an unexpected DSH client injection boundary')
}

console.log(`verify-package: ${required.length} artifacts and DSH authority checks passed`)
