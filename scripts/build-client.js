import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const id = '@ichaival/dsh-unified-search'
const external = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives']
const result = await build({
  absWorkingDir: root, entryPoints: ['src/client/index.jsx'], outfile: 'lib/client.js',
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  external, loader: { '.css': 'text' }, sourcemap: true, metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  plugins: [{ name: 'public-platform-imports', setup(context) {
    context.onResolve({ filter: /^[^./]|^@/ }, args => {
      if (args.kind === 'entry-point' || external.includes(args.path)) return
      throw new Error(`Unexpected client dependency ${args.path}; use injected services or a public platform module`)
    })
  } }],
})
if (Object.keys(result.metafile.inputs).some(name => name.includes('node_modules'))) throw new Error('Client bundle must reuse DSH platform libraries, not inline another copy')
await mkdir(new URL('../.build/', import.meta.url), { recursive: true })
await writeFile(new URL('../.build/client-meta.json', import.meta.url), JSON.stringify(result.metafile, null, 2))
console.log('Built lib/client.js with shared DSH platform modules')
