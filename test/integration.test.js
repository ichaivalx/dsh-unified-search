import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { createScope, bindScopeParent, scopeTarget } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import * as plugin from '../src/index.js'

class Credentials extends CredentialProvider {
  async resolve(ref) { return { value: `mock-${ref}`, source: 'test' } }
}
class Agents extends Service {
  constructor(ctx) { super(ctx, 'agents'); this.live = [] }
  list() { return [...this.live] }
}
class Runtime extends PtcRuntime {
  constructor(ctx) { super(ctx); this.language = 'typescript'; this.isolation = 'test' }
  resolve(request) { return { ...request, cwd: process.cwd(), timeoutMs: 1000 } }
  async run(request) {
    return { logs: [], value: await request.bindings[0].functions.web_search({ query: 'PTC query' }) }
  }
}
const original = name => defineTool({ name, description: `Original ${name}`, parameters: { queries: { type: 'array', items: { type: 'string' }, required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'original' })

async function scope(ctx, id, parent, status = 'idle') {
  const agent = { id, status, session: { header: {}, append() {} } }
  let owner
  await ctx.plugin(Object.assign(inner => { owner = createScope(inner, agent); agent.ctx = owner.ctx }, { inject: ['tools', 'systemPrompt'] }))
  const binding = parent ? bindScopeParent(agent, parent) : undefined
  return { agent, owner, binding }
}
async function boot(mode = 'native') {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools, { mode })
  await ctx.plugin(Credentials)
  await ctx.plugin(Agents)
  if (mode !== 'native') await ctx.plugin(Runtime)
  const preset = await scope(ctx, 'preset')
  for (const name of ['web_search', 'web_fetch']) preset.agent.ctx.tools.register(original(name))
  preset.agent.ctx.systemPrompt.section({ name: 'tool:web_search', order: 100, text: 'OLD queries array guidance' })
  return { ctx, preset }
}
const names = (ctx, agent) => ctx.tools.schemas(agent).map(tool => tool.name)

test('live Config validates budgets and duplicate references before accepting updates', () => {
  for (const input of [
    { providers: { tavily: { searchTimeoutMs: 0 } } },
    { providers: { tavily: { keys: [{ ref: 'DUP' }, { ref: 'DUP' }] } } },
    { providers: { tavily: { extractTimeoutSeconds: NaN } } },
  ]) {
    let rejected = false
    try {
      const result = plugin.Config['~standard'].validate(input)
      rejected = Boolean(result.issues)
    } catch { rejected = true }
    assert.equal(rejected, true)
  }
})

test('real DSH scope shadow: schemas, native execution, prompt, children, minimal and unload', async t => {
  const { ctx, preset } = await boot()
  t.after(() => ctx.fiber.dispose())
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ results: [{ title: 'Source', url: 'https://example.com', content: 'body' }] }))
  })
  const root = await scope(ctx, 'root', preset.agent)
  ctx.agents.live.push(root.agent)
  const fiber = ctx.plugin(plugin)
  await fiber
  const child = await scope(ctx, 'child', preset.agent)
  await ctx.serial(scopeTarget(child.agent, child.agent), 'agent/created', { agent: child.agent, source: 'startup' })
  const minimal = await scope(ctx, 'minimal')
  await ctx.serial(scopeTarget(minimal.agent, minimal.agent), 'agent/created', { agent: minimal.agent, source: 'startup' })
  for (const { agent } of [root, child]) {
    const schemas = ctx.tools.schemas(agent)
    assert.equal(schemas.filter(s => s.name === 'web_search').length, 1)
    assert.deepEqual(schemas.find(s => s.name === 'web_search').parameters.required, ['query'])
    assert.equal(ctx.tools.get('web_search', agent).timeoutMs, undefined)
    const assembled = await ctx.systemPrompt.assemble({ scope: agent })
    assert.match(assembled.sections.find(s => s.name === 'tool:web_search').text, /required query string/)
    const response = await ctx.tools.execute({ agent, name: 'web_search', arguments: { query: 'native' }, callId: 'test-call', signal: new AbortController().signal })
    assert.equal(response.isError, false)
    const definition = ctx.tools.get('web_search', agent)
    assert.equal(definition.presentCall({ query: 'native' }).title, 'native')
    assert.equal(definition.presentResult({ query: 'native' }, response).card, 'web')
    assert.match(response.content[0].text, /Provider: tavily/)
  }
  assert.deepEqual(names(ctx, minimal.agent), [])
  updateVolatile(fiber.config, plugin.Config({ providers: { tavily: { searchDepth: 'basic' } } }))
  await ctx.tools.execute({ agent: root.agent, name: 'web_search', arguments: { query: 'new settings' }, callId: 'after-setting', signal: new AbortController().signal })
  assert.equal(requests.at(-1).search_depth, 'basic')
  updateVolatile(fiber.config, plugin.Config({ providers: { tavily: { maxResults: 2, snippetMaxChars: 3, fetchMaxChars: 4 } } }))
  updateVolatile(fiber.config, plugin.Config({ providers: { tavily: { maxResults: null, snippetMaxChars: null, fetchMaxChars: null } } }))
  const saved = fiber.config.get().providers.tavily
  assert.equal(saved.maxResults, null)
  assert.equal(saved.snippetMaxChars, null)
  assert.equal(saved.fetchMaxChars, null)
  await ctx.tools.execute({ agent: root.agent, name: 'web_search', arguments: { query: 'cleared limits' }, callId: 'cleared-limits', signal: new AbortController().signal })
  assert.equal(Object.hasOwn(requests.at(-1), 'max_results'), false)
  await child.owner.dispose()
  assert.equal(ctx.tools.get('web_search', child.agent).description, 'Original web_search')
  await fiber.dispose()
  assert.equal(ctx.tools.get('web_search', root.agent).description, 'Original web_search')
  assert.match((await ctx.systemPrompt.assemble({ scope: root.agent })).sections.find(s => s.name === 'tool:web_search').text, /OLD queries/)
  const later = await scope(ctx, 'later', preset.agent)
  await ctx.serial(scopeTarget(later.agent, later.agent), 'agent/created', { agent: later.agent, source: 'startup' })
  assert.equal(ctx.tools.get('web_search', later.agent).description, 'Original web_search')
})

test('running existing agents keep current schema until their own idle event', async t => {
  const { ctx, preset } = await boot()
  t.after(() => ctx.fiber.dispose())
  const running = await scope(ctx, 'busy', preset.agent, 'running')
  ctx.agents.live.push(running.agent)
  await ctx.plugin(plugin)
  assert.equal(ctx.tools.get('web_search', running.agent).description, 'Original web_search')
  running.agent.status = 'idle'
  ctx.emit(scopeTarget(running.agent, running.agent), 'agent/status', { agent: running.agent, status: 'idle' })
  assert.deepEqual(ctx.tools.get('web_search', running.agent).parameters.required, ['query'])
})

test('blank-session preset changes refresh capabilities including minimal', async t => {
  const { ctx, preset } = await boot()
  t.after(() => ctx.fiber.dispose())
  const root = await scope(ctx, 'switchable', preset.agent)
  const minimalPreset = await scope(ctx, 'minimal-preset')
  ctx.agents.live.push(root.agent)
  await ctx.plugin(plugin)
  assert.equal(names(ctx, root.agent).length, 2)
  root.binding.rebind(minimalPreset.agent)
  ctx.emit('agent-preset/selected', root.agent.id, 'minimal')
  assert.deepEqual(names(ctx, root.agent), [])
  root.binding.rebind(preset.agent)
  ctx.emit('agent-preset/selected', root.agent.id, 'standard')
  assert.deepEqual(ctx.tools.get('web_search', root.agent).parameters.required, ['query'])
  root.agent.status = 'running'
  root.binding.rebind(minimalPreset.agent)
  ctx.emit('agent-preset/selected', root.agent.id, 'minimal')
  assert.equal(names(ctx, root.agent).length, 2)
  root.agent.status = 'idle'
  ctx.emit(scopeTarget(root.agent, root.agent), 'agent/status', { agent: root.agent, status: 'idle' })
  assert.deepEqual(names(ctx, root.agent), [])
})

test('real DSH PTC SDK and dispatch use exactly the same shadow definition', async t => {
  const { ctx, preset } = await boot('ptc')
  t.after(() => ctx.fiber.dispose())
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [{ title: 'Source', url: 'https://example.com', content: 'PTC body' }] })))
  await ctx.plugin(plugin)
  const child = await scope(ctx, 'ptc-child', preset.agent)
  await ctx.serial(scopeTarget(child.agent, child.agent), 'agent/created', { agent: child.agent, source: 'startup' })
  const assembly = await ctx.systemPrompt.assemble({ scope: child.agent })
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['run_code'])
  const sdk = assembly.sections.find(section => section.name === 'tools:sdk').text
  assert.match(sdk, /query: string/)
  assert.doesNotMatch(sdk, /queries:/)
  assert.match(sdk, /snippet: string/)
  assert.match(sdk, /content: string/)
  const result = await ctx.tools.execute({ agent: child.agent, name: 'run_code', arguments: { code: 'return await tools.web_search({query: "PTC query"})', description: 'Test scoped search' }, callId: 'ptc', signal: new AbortController().signal })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(result.content[0].text, /PTC body/)
})
