import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

test('client artifact loads through the installed DSH module system with shared platform imports', async () => {
  const anchor = process.env.DSH_RUNTIME_ANCHOR
  assert.ok(anchor, 'Set DSH_RUNTIME_ANCHOR to an installed DSH package.json')
  const hostRequire = createRequire(anchor)
  const bootstrapSource = await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-modules/client'), 'utf8')
  const artifact = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const meta = JSON.parse(await readFile(new URL('../.build/client-meta.json', import.meta.url), 'utf8'))
  assert.equal(Object.keys(meta.inputs).some(path => path.includes('node_modules')), false)
  const external = Object.values(meta.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path))
  assert.deepEqual([...new Set(external)].sort(), ['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'].sort())
  const pending = []
  const target = { mode: 'queue', pendingQueue: pending, load: registration => pending.push(registration) }
  const sandbox = { window: { __ModuleLoader__: target }, console, setTimeout, clearTimeout, URL, AbortController, document: { querySelectorAll: () => [] } }
  vm.runInNewContext(bootstrapSource, sandbox)
  const bootstrap = pending.shift()
  const exports = bootstrap.factory(() => { throw new Error('Unexpected bootstrap dependency') })
  const id = '@ichaival/dsh-unified-search'
  const url = '/plugins/unified-test/client.js'
  const seeds = { react: { useState() {} }, 'react/jsx-runtime': {}, '@deepseek-ai/dsh-client-store': {}, '@deepseek-ai/dsh-client-ui-primitives': {} }
  const loader = exports.createClientModuleSystem(target, { id: bootstrap.id, exports }, {
    boot: { rev: 'test', entries: [{ id, url, rev: '1.1.0' }], batches: [{ phase: 'application', url, rev: '1.1.0', entries: [id] }] },
    staticModules: seeds,
    loadBundle: async () => { vm.runInNewContext(artifact, sandbox) },
  })
  const client = await loader.import(id, '', {})
  assert.deepEqual(Object.keys(client).sort(), ['apply', 'inject'])
  assert.equal(typeof client.apply, 'function')
  assert.equal(client, await loader.import(id, '', {}))
  assert.ok(client.inject.includes('settingsScope'))
  assert.ok(client.inject.includes('remote.credentials'))
})
