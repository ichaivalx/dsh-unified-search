import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { PROVIDERS } from './config.js'
import { buildRequest, normalizeResponse, SearchError } from './providers.js'

/** One coordinator per plugin instance; reserve rotation slots before the first await. */
export class UnifiedSearchClient {
  constructor({ getSettings, resolveCredential, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.getSettings = getSettings
    this.resolveCredential = resolveCredential
    this.fetch = fetchImpl
    this.now = now
    this.cursors = new Map()
    this.controller = new AbortController()
  }
  dispose() { this.controller.abort() }

  async run(operation, args, callerSignal) {
    const settings = this.getSettings()
    const provider = args?.provider ?? settings[operation === 'search' ? 'defaultSearchProvider' : 'defaultFetchProvider']
    if (!PROVIDERS.includes(provider)) throw new SearchError('INVALID_ARGUMENT', 'provider must be tavily, exa, or firecrawl')
    const config = settings.providers[provider]
    const request = buildRequest(operation, args, provider, config, this.now())
    const keys = config.keys.filter(key => key.enabled)
    if (!keys.length) throw new SearchError('NO_CREDENTIAL', `${provider} has no enabled credential references`)
    let start = 0
    if (config.keyStrategy === 'round-robin') {
      start = (this.cursors.get(provider) ?? 0) % keys.length
      this.cursors.set(provider, (start + 1) % keys.length)
    }
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), config[operation === 'search' ? 'searchTimeoutMs' : 'fetchTimeoutMs'])
    const signal = AbortSignal.any([this.controller.signal, timeout.signal, ...(callerSignal ? [callerSignal] : [])])
    let attempts = 0
    let failure = new SearchError('NO_CREDENTIAL', `${provider} has no resolvable credential references`)
    // Distinct references may resolve to the same key; never submit it twice for this request.
    const usedSecrets = new Set()
    try {
      for (let offset = 0; offset < keys.length; offset++) {
        signal.throwIfAborted()
        let resolved
        try { resolved = await this.resolveCredential(credentialRef(keys[(start + offset) % keys.length].ref)) }
        catch { throw new SearchError('CREDENTIAL_ERROR', `${provider} credential resolution failed`) }
        signal.throwIfAborted()
        if (!resolved?.value || usedSecrets.has(resolved.value)) continue
        usedSecrets.add(resolved.value)
        attempts++
        const headers = { 'Content-Type': 'application/json', ...(provider === 'exa' ? { 'x-api-key': resolved.value } : { Authorization: `Bearer ${resolved.value}` }) }
        let response
        try { response = await this.fetch(request.url, { method: 'POST', headers, body: JSON.stringify(request.body), signal }) }
        catch {
          if (signal.aborted) signal.throwIfAborted()
          throw new SearchError('NETWORK_ERROR', `${provider} network request failed; not retried because it may already have been billed`)
        }
        signal.throwIfAborted()
        if (!response.ok) {
          // Never echo provider error bodies or fetch error messages: they may contain credentials.
          await response.body?.cancel().catch(() => {})
          const retryable = [401, 402, 429].includes(response.status) || (provider === 'tavily' && [432, 433].includes(response.status))
          failure = new SearchError(`HTTP_${response.status}`, `${provider} request failed (HTTP ${response.status})${retryable ? '; credential unavailable, exhausted or rate-limited' : '; not retried'}`)
          if (retryable) continue
          throw failure
        }
        let data
        try { data = await response.json() }
        catch {
          if (signal.aborted) signal.throwIfAborted()
          throw new SearchError('INVALID_RESPONSE', `${provider} returned unreadable JSON; not retried`)
        }
        signal.throwIfAborted()
        return normalizeResponse(operation, provider, data, config, request, attempts)
      }
      throw failure
    } catch (error) {
      if (signal.aborted) throw new SearchError(timeout.signal.aborted && !callerSignal?.aborted && !this.controller.signal.aborted ? 'TIMEOUT' : 'ABORTED', `${provider} request ${timeout.signal.aborted && !callerSignal?.aborted && !this.controller.signal.aborted ? 'timed out' : 'was cancelled'}; not retried`)
      throw error
    } finally { clearTimeout(timer) }
  }
}
