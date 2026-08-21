/** Standalone DSH Host/client bundle configuration. */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)
const ID = 'dsh-project-terminal'
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const GLOBAL_CSS = '@xterm/xterm/css/xterm.css'
const CLIENT_EXTERNALS: readonly string[] = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${resolve('lib/types')}/`
  if (!emitted.startsWith(marker)) return emitted
  return resolve('src', emitted.slice(marker.length))
}

function cssModule(fileId: string, source: Buffer, modules: boolean): string {
  const { code, exports: cssExports } = transform({
    filename: fileId,
    code: source,
    ...modules ? { cssModules: { pattern: '[hash]_[local]' } } : {},
    minify: true,
  })
  const classMap: Record<string, string> = {}
  for (const [local, value] of Object.entries(cssExports ?? {})) classMap[local] = value.name
  const tagId = `${ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(code.toString())};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'let mounts = 0;',
    'export function mountCss() {',
    "  if (typeof document === 'undefined') return () => {};",
    "  let tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']');",
    '  if (tag === null) {',
    "    tag = document.createElement('style');",
    `    tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '    tag.dataset.pluginCss = tagId;',
    '    tag.textContent = css;',
    '    document.head.appendChild(tag);',
    '  }',
    '  mounts += 1;',
    '  let active = true;',
    '  return () => {',
    '    if (!active) return;',
    '    active = false;',
    '    mounts = Math.max(0, mounts - 1);',
    '    if (mounts === 0) tag.remove();',
    '  };',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

export default defineConfig([{
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}, {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(`client bundle purity: runtime import ${JSON.stringify(source)} is not supplied by DSH`)
    },
  }, {
    name: 'dsh-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (source === GLOBAL_CSS) return CSS_VIRTUAL_PREFIX + require.resolve(source) + CSS_VIRTUAL_SUFFIX
      if (!source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? source : sourceAssetPath(source, importer)
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      return cssModule(fileId, await readFile(fileId), fileId.endsWith('.module.css'))
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}])
