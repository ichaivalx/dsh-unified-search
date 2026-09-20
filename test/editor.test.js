import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultConfig } from '../src/config.js'
import { SearchSettingsEditor } from '../src/client/editor.js'

function harness(overrides = {}) {
  let snapshot = { status: 'ready', value: structuredClone(defaultConfig), revision: 1, writable: true, mode: 'host' }
  const listeners = new Set()
  const calls = [], keys = []
  const scope = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  const publish = next => { snapshot = { ...snapshot, ...next }; for (const fn of listeners) fn() }
  const controller = new SearchSettingsEditor({
    scope,
    createStore: initial => {
      let state = initial
      const subscribers = new Set()
      return { getSnapshot: () => state, set: next => { state = next; for (const listener of subscribers) listener() }, subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener) } }
    },
    mutate: overrides.mutate ?? (async (ops, revision) => {
      calls.push({ ops, revision })
      assert.equal(revision, snapshot.revision)
      const value = structuredClone(snapshot.value)
      for (const op of ops) {
        let object = value
        for (const part of op.path.slice(0, -1)) object = object[part]
        object[op.path.at(-1)] = op.value
      }
      return { ok: true, value: { value, revision: revision + 1 } }
    }),
    acceptView: view => publish({ value: view.value, revision: view.revision }),
    credentials: {
      describe: overrides.describe ?? (async refs => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])) })),
      set: overrides.set ?? (async (ref, value) => { keys.push({ ref, value }); return { ok: true } }),
    },
  })
  return { controller, calls, keys, publish, scope, state: () => controller.store.getSnapshot() }
}

test('opening never writes; saving only changed paths preserves hidden/unknown values', async () => {
  const h = harness()
  const value = structuredClone(defaultConfig)
  value.futureSetting = { preserved: true }
  h.publish({ value, revision: 2 })
  assert.equal(h.calls.length, 0)
  h.controller.edit(['defaultSearchProvider'], 'exa')
  h.controller.edit(['providers', 'exa', 'searchType'], 'deep')
  await h.controller.save()
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0].ops.map(op => op.path), [['defaultSearchProvider'], ['providers', 'exa', 'searchType']])
  assert.equal(h.calls[0].revision, 2)
  assert.deepEqual(h.state().values.futureSetting, { preserved: true })
  assert.equal(h.state().values.defaultFetchProvider, 'firecrawl')
  assert.equal(h.state().dirty, false)
  h.controller.dispose()
})

test('optional result/output limits clear to null while explicit invalid limits are rejected', async () => {
  const h = harness()
  const value = structuredClone(defaultConfig)
  Object.assign(value.providers.tavily, { maxResults: 5, snippetMaxChars: 4000, fetchMaxChars: 100000 })
  h.publish({ value, revision: 2 })
  h.controller.edit(['providers', 'tavily', 'maxResults'], null)
  h.controller.edit(['providers', 'tavily', 'snippetMaxChars'], '')
  h.controller.edit(['providers', 'tavily', 'fetchMaxChars'], null)
  assert.equal(h.controller.validationError(), null)
  await h.controller.save()
  assert.deepEqual(h.calls[0].ops.map(op => op.value), [null, null, null])
  assert.equal(h.state().values.providers.tavily.searchTimeoutMs, defaultConfig.providers.tavily.searchTimeoutMs)
  assert.equal(h.state().dirty, false)
  for (const [field, number] of [['snippetMaxChars', 0], ['fetchMaxChars', -1], ['maxResults', 21]]) {
    h.controller.edit(['providers', 'tavily', field], number)
    assert.equal(h.controller.validationError().kind, 'invalidNumber')
    h.controller.edit(['providers', 'tavily', field], null)
    assert.equal(h.controller.validationError(), null)
  }
  h.controller.edit(['providers', 'tavily', 'searchTimeoutMs'], null)
  assert.equal(h.controller.validationError().field, 'searchTimeoutMs')
  h.controller.dispose()
})

test('external YAML updates retain drafts and block stale saves until explicit rebase', async () => {
  const h = harness()
  h.controller.edit(['defaultSearchProvider'], 'exa')
  const next = structuredClone(defaultConfig)
  next.providers.tavily.snippetMaxChars = 7000
  h.publish({ value: next, revision: 2 })
  assert.equal(h.state().conflict, true)
  assert.equal(h.state().values.defaultSearchProvider, 'exa')
  await h.controller.save()
  assert.equal(h.calls.length, 0)
  assert.equal(h.state().error.kind, 'conflict')
  h.controller.rebase()
  assert.equal(h.state().conflict, false)
  assert.equal(h.state().values.providers.tavily.snippetMaxChars, 7000)
  await h.controller.save()
  assert.equal(h.calls[0].revision, 2)
  h.controller.dispose()
})

test('multi-key add/replace/disable/remove saves only refs and never unsets credentials', async () => {
  const h = harness()
  h.controller.addKey('tavily')
  const [first, second] = h.state().rows.tavily
  assert.equal(second.ref, 'TAVILY_API_KEY_2')
  h.controller.editKey('tavily', second.id, 'secret', 'test-secret')
  h.controller.editKey('tavily', first.id, 'enabled', false)
  h.controller.edit(['providers', 'tavily', 'keyStrategy'], 'failover')
  await h.controller.save()
  assert.deepEqual(h.keys, [{ ref: 'TAVILY_API_KEY_2', value: 'test-secret' }])
  assert.equal(JSON.stringify(h.calls).includes('test-secret'), false)
  assert.equal(h.state().rows.tavily[1].secret, '')
  h.controller.removeKey('tavily', h.state().rows.tavily[0].id)
  await h.controller.save()
  assert.equal(h.state().rows.tavily.length, 1)
  assert.equal(h.keys.length, 1)
  h.controller.dispose()
})

test('explicit rebase retains a password draft even if its reference was removed externally', () => {
  const h = harness()
  h.controller.editKey('exa', h.state().rows.exa[0].id, 'secret', 'unsaved-secret')
  const config = structuredClone(defaultConfig)
  config.providers.exa.keys = []
  h.publish({ value: config, revision: 2 })
  h.controller.rebase()
  assert.equal(h.state().rows.exa[0].ref, 'EXA_API_KEY')
  assert.equal(h.state().rows.exa[0].secret, 'unsaved-secret')
  assert.equal(h.state().values.providers.exa.keys[0].ref, 'EXA_API_KEY')
  h.controller.dispose()
})

test('credential succeeds then settings conflict: disclose partial success and retain config draft', async () => {
  const h = harness({ mutate: async () => ({ ok: false, error: { code: 'settings/conflict' } }) })
  const row = h.state().rows.exa[0]
  h.controller.editKey('exa', row.id, 'secret', 'new-secret')
  h.controller.edit(['providers', 'exa', 'searchType'], 'fast')
  await h.controller.save()
  assert.deepEqual(h.state().error, { kind: 'conflict', savedKeyRefs: ['EXA_API_KEY'] })
  assert.equal(h.state().rows.exa[0].secret, '')
  assert.equal(h.state().values.providers.exa.searchType, 'fast')
  assert.equal(h.state().dirty, true)
  assert.equal(h.state().saving, false)
  h.controller.dispose()
})

test('credential failure and settings rejection preserve unfinished drafts; cancel discards only drafts', async () => {
  const h = harness({ set: async () => ({ ok: false, error: { code: 'credential/rejected' } }) })
  h.controller.editKey('firecrawl', h.state().rows.firecrawl[0].id, 'secret', 'retained-secret')
  h.controller.edit(['defaultSearchProvider'], 'firecrawl')
  await h.controller.save()
  assert.equal(h.state().rows.firecrawl[0].secret, 'retained-secret')
  assert.equal(h.state().error.kind, 'keyWrite')
  assert.equal(h.calls.length, 0)
  h.controller.discard()
  assert.equal(h.state().dirty, false)
  assert.equal(h.state().rows.firecrawl[0].secret, '')
  h.controller.dispose()
  const rejected = harness({ mutate: async () => ({ ok: false, error: { code: 'settings/rejected' } }) })
  rejected.controller.edit(['providers', 'tavily', 'topic'], 'news')
  await rejected.controller.save()
  assert.equal(rejected.state().values.providers.tavily.topic, 'news')
  assert.equal(rejected.state().error.kind, 'settingsWrite')
  rejected.controller.dispose()
})

test('describe batches follow protocol without limiting total key count', async () => {
  const batches = []
  const h = harness({ describe: async refs => { batches.push(refs); return { ok: true, value: {} } } })
  const config = structuredClone(defaultConfig)
  config.providers.exa.keys = Array.from({ length: 130 }, (_, index) => ({ ref: `EXA_${index}`, enabled: true }))
  h.publish({ value: config, revision: 2 })
  await h.controller.refreshCredentials(true)
  assert.equal(h.state().rows.exa.length, 130)
  assert.ok(batches.every(batch => batch.length <= 64))
  h.controller.dispose()
})
