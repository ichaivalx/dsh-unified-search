import test from 'node:test'
import assert from 'node:assert/strict'
import { SettingsSchema, defaultConfig, validateSettings } from '../src/config.js'
import { UnifiedSearchClient } from '../src/client.js'
import { buildRequest } from '../src/providers.js'

const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const result = { results: [{ title: 'Example', url: 'https://example.com', content: 'abcdef', published_date: '2026-09-20' }], usage: { credits: 2 }, request_id: 'req' }
function setup(fetchImpl, change = () => {}) {
  const config = structuredClone(defaultConfig)
  change(config)
  const calls = [], refs = []
  const client = new UnifiedSearchClient({ getSettings: () => config,
    resolveCredential: async ref => { refs.push(ref); return { value: `secret-${ref}`, source: 'test' } },
    fetchImpl: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return fetchImpl(url, options, calls.length) },
    now: () => Date.parse('2024-03-31T12:30:00Z'),
  })
  return { client, config, calls, refs }
}

test('defaults, settings validation and live settings snapshots', async () => {
  validateSettings(defaultConfig)
  for (const config of Object.values(defaultConfig.providers)) {
    for (const field of ['maxResults', 'snippetMaxChars', 'fetchMaxChars']) assert.equal(config[field] == null, true)
  }
  const empty = SettingsSchema({ providers: { tavily: { maxResults: null, snippetMaxChars: null, fetchMaxChars: null } } })
  validateSettings(empty)
  assert.equal(empty.providers.tavily.maxResults, null)
  for (const field of ['snippetMaxChars', 'fetchMaxChars']) {
    assert.throws(() => validateSettings(SettingsSchema({ providers: { tavily: { [field]: 0 } } })), /positive safe integer/)
  }
  assert.equal(defaultConfig.providers.exa.searchType, 'deep-reasoning')
  validateSettings(SettingsSchema({ providers: { tavily: { maxResults: 0 } } }))
  assert.equal(buildRequest('search', { query: 'x', maxResults: 0 }, 'tavily', defaultConfig.providers.tavily).body.max_results, 0)
  assert.throws(() => validateSettings(SettingsSchema({ providers: { tavily: { maxResults: 21 } } })), /API limit/)
  assert.throws(() => validateSettings(SettingsSchema({ providers: { exa: { keys: [{ ref: 'bad-ref' }] } } })), /credential ref/)
  const s = setup(() => ok(result))
  await s.client.run('search', { query: 'first' })
  s.config.providers.tavily.searchDepth = 'basic'
  s.config.providers.tavily.keys = [{ ref: 'SECOND_KEY', enabled: true }]
  await s.client.run('search', { query: 'second' })
  assert.equal(s.calls[0].body.search_depth, 'advanced')
  assert.equal(s.calls[1].body.search_depth, 'basic')
  assert.deepEqual(s.refs, ['TAVILY_API_KEY', 'SECOND_KEY'])
})

test('all providers omit blank counts and preserve all returned results and content', async () => {
  const snippet = 'x'.repeat(5001)
  const content = 'y'.repeat(100005)
  const rows = Array.from({ length: 7 }, (_, index) => ({ title: `Page ${index}`, url: `https://example.com/${index}`, content: snippet, highlights: [snippet], description: snippet }))
  for (const provider of ['tavily', 'exa', 'firecrawl']) {
    for (const explicitNull of [false, true]) {
      const s = setup(url => ok(url.endsWith('/search')
        ? { success: true, results: rows, data: { web: rows } }
        : { success: true, results: [{ url: 'https://example.com', raw_content: content, text: content }], data: { markdown: content, metadata: { sourceURL: 'https://example.com' } } }), config => {
        if (explicitNull) Object.assign(config.providers[provider], { maxResults: null, snippetMaxChars: null, fetchMaxChars: null })
      })
      const search = await s.client.run('search', { query: 'x', provider })
      assert.equal(Object.hasOwn(s.calls[0].body, { tavily: 'max_results', exa: 'numResults', firecrawl: 'limit' }[provider]), false)
      assert.equal(search.results.length, 7)
      assert.equal(search.results[0].snippet, snippet)
      assert.equal(search.truncated, false)
      const fetch = await s.client.run('fetch', { url: 'https://example.com', provider })
      assert.equal(fetch.content, content)
      assert.equal(fetch.truncated, false)
    }
  }
})

test('explicit count/character budgets still apply and model count overrides configuration', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({ url: `https://example.com/${index}`, content: 'abcdef', highlights: ['abcdef'], description: 'abcdef' }))
  for (const provider of ['tavily', 'exa', 'firecrawl']) {
    const s = setup(url => ok(url.endsWith('/search')
      ? { success: true, results: rows, data: { web: rows } }
      : { success: true, results: [{ url: 'https://example.com', raw_content: 'abcdef', text: 'abcdef' }], data: { markdown: 'abcdef' } }), config => {
      Object.assign(config.providers[provider], { maxResults: 2, snippetMaxChars: 3, fetchMaxChars: 4 })
    })
    assert.equal((await s.client.run('search', { query: 'x', provider })).results.length, 2)
    const search = await s.client.run('search', { query: 'x', provider, maxResults: 1 })
    const field = { tavily: 'max_results', exa: 'numResults', firecrawl: 'limit' }[provider]
    assert.equal(s.calls[0].body[field], 2)
    assert.equal(s.calls[1].body[field], 1)
    assert.equal(search.results.length, 1)
    assert.equal(search.results[0].snippet, 'abc')
    assert.equal(search.truncated, true)
    const fetch = await s.client.run('fetch', { url: 'https://example.com', provider })
    assert.equal(fetch.content, 'abcd')
    assert.equal(fetch.truncated, true)
  }
})

test('three search APIs: only one provider, correct filters, usage and explicit truncation', async () => {
  const s = setup((url) => ok(url.includes('tavily') ? result : url.includes('exa')
    ? { results: [{ title: 'Exa', url: 'https://exa.ai', highlights: ['abcdef'], publishedDate: '2026-01-01' }], costDollars: { total: 0.015 }, requestId: 'exa-req' }
    : { success: true, data: { web: [{ title: 'Fire', url: 'https://firecrawl.dev', description: 'abcdef' }] }, creditsUsed: 2 }), config => {
      for (const item of Object.values(config.providers)) item.snippetMaxChars = 3
    })
  for (const provider of ['tavily', 'exa', 'firecrawl']) {
    const response = await s.client.run('search', { query: 'topic', provider, maxResults: 3, includeDomains: ['example.com'], timeRange: 'month' })
    assert.equal(response.provider, provider)
    assert.equal(response.results[0].snippet, 'abc')
    assert.equal(response.results[0].originalChars, 6)
    assert.equal(response.truncated, true)
  }
  assert.equal(s.calls.length, 3)
  assert.equal(s.calls[0].body.time_range, 'month')
  assert.equal(s.calls[1].body.startPublishedDate, '2024-02-29T12:30:00.000Z')
  assert.deepEqual(s.calls[1].body.contents, { highlights: true })
  assert.equal(s.calls[1].body.type, 'deep-reasoning')
  assert.equal(s.calls[2].body.tbs, 'qdr:m')
  assert.equal(s.calls[2].body.scrapeOptions, undefined)
  assert.deepEqual(s.calls[2].body.sources, ['web'])
  assert.equal(buildRequest('search', { query: 'x', timeRange: 'year' }, 'exa', defaultConfig.providers.exa, Date.parse('2024-02-29T00:00Z')).body.startPublishedDate, '2023-02-28T00:00:00.000Z')
})

test('reject unsupported input before resolving credentials or sending requests', async () => {
  const s = setup(() => ok(result))
  for (const args of [
    { query: '' }, { queries: ['x'] }, { query: 'x', provider: 'other' }, { query: 'x', maxResults: 21 },
    { query: 'x', provider: 'firecrawl', includeDomains: ['example.com'], excludeDomains: ['other.com'] },
    { query: 'x', provider: 'firecrawl', includeDomains: ['example.com/docs'] },
    { query: 'x', provider: 'exa', includeDomains: Array(1201).fill('a.com') },
    { query: 'x', timeRange: 'forever' },
  ]) await assert.rejects(s.client.run('search', args), { code: 'INVALID_ARGUMENT' })
  assert.equal(s.calls.length, 0)
  assert.equal(s.refs.length, 0)
})

test('round-robin reserves positions across concurrent requests; failover starts at first key', async () => {
  const s = setup(() => ok(result), c => { c.providers.tavily.keys = [{ ref: 'ONE', enabled: true }, { ref: 'OFF', enabled: false }, { ref: 'TWO', enabled: true }] })
  await Promise.all(Array.from({ length: 4 }, () => s.client.run('search', { query: 'x' })))
  assert.deepEqual(s.calls.map(c => c.headers.Authorization), ['Bearer secret-ONE', 'Bearer secret-TWO', 'Bearer secret-ONE', 'Bearer secret-TWO'])
  s.config.providers.tavily.keyStrategy = 'failover'
  await Promise.all(Array.from({ length: 2 }, () => s.client.run('search', { query: 'x' })))
  assert.deepEqual(s.calls.slice(-2).map(c => c.headers.Authorization), ['Bearer secret-ONE', 'Bearer secret-ONE'])
})

test('only explicit key errors trigger failover, without ever echoing response secrets', async () => {
  for (const status of [401, 402, 429, 432, 433, 403, 400, 500]) {
    const s = setup((_url, _options, count) => count === 1 ? new Response('secret-ONE', { status }) : ok(result), c => {
      c.providers.tavily.keys = [{ ref: 'ONE', enabled: true }, { ref: 'TWO', enabled: true }]
    })
    if ([401, 402, 429, 432, 433].includes(status)) {
      const response = await s.client.run('search', { query: 'x' })
      assert.equal(response.usage.attempts, 2)
    } else {
      await assert.rejects(s.client.run('search', { query: 'x' }), error => !error.message.includes('secret-ONE') && error.code === `HTTP_${status}`)
      assert.equal(s.calls.length, 1)
    }
  }
})

test('network failure, timeout, caller cancellation and disposal never retry', async () => {
  const network = setup(() => { throw new Error('secret-ONE') })
  await assert.rejects(network.client.run('search', { query: 'x' }), { code: 'NETWORK_ERROR' })
  assert.equal(network.calls.length, 1)
  for (const mode of ['timeout', 'caller', 'dispose']) {
    const s = setup((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('secret-ONE')), { once: true })), c => {
      c.providers.tavily.searchTimeoutMs = 10
      c.providers.tavily.keys.push({ ref: 'TWO', enabled: true })
    })
    const controller = new AbortController()
    const promise = s.client.run('search', { query: 'x' }, controller.signal)
    if (mode !== 'timeout') setTimeout(() => mode === 'caller' ? controller.abort() : s.client.dispose(), 1)
    await assert.rejects(promise, { code: mode === 'timeout' ? 'TIMEOUT' : 'ABORTED' })
    assert.equal(s.calls.length, 1)
  }
})

test('each actual key attempted only once, including duplicate secret aliases', async () => {
  let count = 0
  const config = structuredClone(defaultConfig)
  config.providers.tavily.keys = [{ ref: 'A', enabled: true }, { ref: 'B', enabled: true }]
  const client = new UnifiedSearchClient({ getSettings: () => config, resolveCredential: async () => ({ value: 'same' }), fetchImpl: async () => { count++; return new Response('', { status: 429 }) } })
  await assert.rejects(client.run('search', { query: 'x' }), { code: 'HTTP_429' })
  assert.equal(count, 1)
})

test('all fetch providers preserve source content, do not request research/agent products', async () => {
  const s = setup(url => ok(url.includes('tavily') ? { results: [{ url: 'https://example.com/', raw_content: '# Body' }] }
    : url.includes('exa') ? { results: [{ url: 'https://example.com/', text: '# Body', title: 'Title' }] }
      : { success: true, data: { markdown: '# Body', metadata: { sourceURL: 'https://example.com/', title: 'Title' } } }))
  for (const provider of ['tavily', 'exa', 'firecrawl']) {
    const response = await s.client.run('fetch', { provider, url: 'https://example.com' })
    assert.equal(response.content, '# Body')
    assert.equal(response.url, 'https://example.com/')
    assert.equal(response.truncated, false)
  }
  assert.deepEqual(s.calls.map(c => new URL(c.url).pathname), ['/extract', '/contents', '/v2/scrape'])
  assert.equal(s.calls[1].body.maxAgeHours, 24)
  s.config.providers.firecrawl.fetchMaxChars = 2
  assert.equal((await s.client.run('fetch', { url: 'https://example.com' })).truncated, true)
})

test('malformed and failed provider responses become explicit errors', async () => {
  for (const payload of [{}, { results: [null] }, { results: [{ title: 'no URL' }] }]) {
    const s = setup(() => ok(payload))
    await assert.rejects(s.client.run('search', { query: 'x' }), { code: 'INVALID_RESPONSE' })
  }
  const s = setup(() => ok({ results: [], failed_results: [{ error: 'secret' }] }))
  await assert.rejects(s.client.run('fetch', { url: 'https://example.com', provider: 'tavily' }), { code: 'FETCH_FAILED' })
})
