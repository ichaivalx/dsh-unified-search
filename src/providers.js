export class SearchError extends Error {
  constructor(code, message) { super(message); this.name = 'UnifiedSearchError'; this.code = code }
}
const fail = (message) => { throw new SearchError('INVALID_ARGUMENT', message) }
const text = (value) => typeof value === 'string' ? value : ''
const arrayText = (value) => Array.isArray(value) ? value.filter(x => typeof x === 'string').join('\n') : text(value)
const clean = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))

function domainList(value, provider, kind) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x.trim())) fail(`${kind} must be an array of non-empty domains`)
  const limit = provider === 'exa' ? 1200 : provider === 'tavily' ? (kind === 'includeDomains' ? 300 : 150) : Infinity
  if (value.length > limit) fail(`${provider} supports at most ${limit} ${kind} entries`)
  for (const domain of value) {
    // Firecrawl accepts hostnames only. Exa additionally documents paths and wildcard subdomains.
    const host = provider === 'exa' ? domain.replace(/^\*\./, '').split('/')[0] : domain
    if (/\s|[?#@:]/.test(domain) || (provider !== 'exa' && /[/*]/.test(domain)) || !host || !/^[\p{L}\p{N}.-]+$/u.test(host)) {
      fail(`${provider} ${kind} requires ${provider === 'exa' ? 'domains, optional paths or wildcard subdomains' : 'hostnames without protocol or path'}`)
    }
  }
  return value.length ? value : undefined
}

function exaStart(timeRange, now) {
  const date = new Date(now)
  if (timeRange === 'day') date.setUTCDate(date.getUTCDate() - 1)
  if (timeRange === 'week') date.setUTCDate(date.getUTCDate() - 7)
  if (timeRange === 'month' || timeRange === 'year') {
    const day = date.getUTCDate()
    date.setUTCDate(1)
    if (timeRange === 'month') date.setUTCMonth(date.getUTCMonth() - 1)
    else date.setUTCFullYear(date.getUTCFullYear() - 1)
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, last))
  }
  return date.toISOString()
}

/** Map the small public surface without silently dropping unsupported filters. */
export function buildRequest(operation, args, provider, config, now = Date.now()) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('arguments must be an object')
  const allowed = operation === 'search'
    ? ['query', 'provider', 'maxResults', 'includeDomains', 'excludeDomains', 'timeRange']
    : ['url', 'provider']
  if (Object.keys(args).some(key => !allowed.includes(key))) fail(`Unsupported parameter; accepted: ${allowed.join(', ')}`)
  const origin = { tavily: 'https://api.tavily.com', exa: 'https://api.exa.ai', firecrawl: 'https://api.firecrawl.dev/v2' }[provider]
  if (operation === 'fetch') {
    let url
    try { url = new URL(args.url) } catch { fail('url must be an absolute HTTP or HTTPS URL') }
    if (!['http:', 'https:'].includes(url.protocol)) fail('url must use HTTP or HTTPS')
    if (provider === 'tavily') return { url: `${origin}/extract`, body: { urls: [url.href], extract_depth: config.extractDepth, timeout: config.extractTimeoutSeconds, format: 'markdown', include_usage: true } }
    if (provider === 'exa') return { url: `${origin}/contents`, body: { urls: [url.href], text: true, maxAgeHours: config.maxAgeHours } }
    return { url: `${origin}/scrape`, body: { url: url.href, formats: ['markdown'], onlyMainContent: config.onlyMainContent, timeout: config.scrapeApiTimeoutMs } }
  }
  if (typeof args.query !== 'string' || !args.query.trim()) fail('query must be a non-empty string')
  if (provider === 'firecrawl' && args.query.length > 500) fail('Firecrawl query has an API limit of 500 characters')
  const maxResults = args.maxResults ?? config.maxResults ?? undefined
  const limit = provider === 'tavily' ? 20 : 100
  const minimum = provider === 'tavily' ? 0 : 1
  if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < minimum || maxResults > limit)) fail(`${provider} maxResults must be between ${minimum} and ${limit}`)
  const include = domainList(args.includeDomains, provider, 'includeDomains')
  const exclude = domainList(args.excludeDomains, provider, 'excludeDomains')
  if (provider === 'firecrawl' && include && exclude) fail('Firecrawl does not allow includeDomains and excludeDomains together; choose one or use another provider')
  if (args.timeRange !== undefined && !['day', 'week', 'month', 'year'].includes(args.timeRange)) fail('timeRange must be day, week, month, or year')
  if (provider === 'tavily') return { url: `${origin}/search`, body: clean({
    query: args.query, max_results: maxResults, search_depth: config.searchDepth, topic: config.topic,
    include_domains: include, exclude_domains: exclude, time_range: args.timeRange,
    include_published_date: true, include_usage: true, include_answer: false, include_raw_content: false,
    auto_parameters: false,
  }), maxResults }
  if (provider === 'exa') return { url: `${origin}/search`, body: clean({
    query: args.query, numResults: maxResults, type: config.searchType,
    includeDomains: include, excludeDomains: exclude,
    startPublishedDate: args.timeRange ? exaStart(args.timeRange, now) : undefined,
    contents: { [config.searchContent]: true },
  }), maxResults }
  return { url: `${origin}/search`, body: clean({
    query: args.query, limit: maxResults, sources: ['web'],
    includeDomains: include, excludeDomains: exclude,
    tbs: args.timeRange ? `qdr:${{ day: 'd', week: 'w', month: 'm', year: 'y' }[args.timeRange]}` : undefined,
    timeout: config.searchApiTimeoutMs, highlights: config.highlights,
  }), maxResults }
}

function clipped(value, maximum) {
  const originalChars = value.length
  if (maximum == null) return { value, truncated: false, originalChars }
  return { value: value.slice(0, maximum), truncated: originalChars > maximum, originalChars }
}

function usageOf(data, attempts) {
  return clean({
    attempts, requestId: typeof (data.request_id ?? data.requestId) === 'string' ? data.request_id ?? data.requestId : undefined,
    credits: typeof (data.usage?.credits ?? data.creditsUsed ?? data.data?.metadata?.creditsUsed) === 'number' ? data.usage?.credits ?? data.creditsUsed ?? data.data?.metadata?.creditsUsed : undefined,
    costDollars: typeof data.costDollars?.total === 'number' ? data.costDollars.total : typeof data.costDollars === 'number' ? data.costDollars : undefined,
    responseTimeSeconds: typeof data.response_time === 'number' ? data.response_time : undefined,
    searchTimeMilliseconds: typeof data.searchTime === 'number' ? data.searchTime : undefined,
  })
}

export function normalizeResponse(operation, provider, data, config, request, attempts) {
  if (!data || typeof data !== 'object' || data.success === false) throw new SearchError('PROVIDER_ERROR', `${provider} returned an unsuccessful response`)
  const usage = usageOf(data, attempts)
  if (operation === 'search') {
    const rows = provider === 'firecrawl' ? data.data?.web : data.results
    if (!Array.isArray(rows)) throw new SearchError('INVALID_RESPONSE', `${provider} returned no search result list`)
    const selected = request.maxResults == null ? rows : rows.slice(0, request.maxResults)
    const results = selected.map(row => {
      if (!row || typeof row !== 'object' || typeof row.url !== 'string' || !row.url.trim()) throw new SearchError('INVALID_RESPONSE', `${provider} returned a search result without a source URL`)
      const snippet = clipped(provider === 'tavily' ? text(row.content) : arrayText(row.highlights) || text(row.text) || text(row.description), config.snippetMaxChars)
      return clean({ provider, title: text(row.title), url: text(row.url), snippet: snippet.value,
        publishedAt: text(row.published_date) || text(row.publishedDate) || text(row.date) || undefined,
        truncated: snippet.truncated, originalChars: snippet.originalChars,
      })
    })
    return { provider, results, usage, truncated: rows.length > results.length || results.some(row => row.truncated), ...(data.warning ? { warning: 'Provider reported a partial-result warning.' } : {}) }
  }
  const row = provider === 'firecrawl' ? data.data : data.results?.[0]
  if (!row || (provider === 'exa' && data.statuses?.some(status => status.status === 'error'))) throw new SearchError('FETCH_FAILED', `${provider} could not retrieve the requested page`)
  const raw = provider === 'tavily' ? row.raw_content : provider === 'exa' ? row.text : row.markdown
  if (typeof raw !== 'string' || !raw.trim()) throw new SearchError('FETCH_FAILED', `${provider} returned no page content`)
  const content = clipped(raw, config.fetchMaxChars)
  return clean({ provider, title: text(row.title ?? row.metadata?.title),
    url: text(row.url ?? row.metadata?.sourceURL) || request.body.url || request.body.urls[0],
    content: content.value, format: provider === 'exa' ? 'text' : 'markdown',
    publishedAt: text(row.published_date ?? row.publishedDate ?? row.metadata?.publishedTime) || undefined,
    truncated: content.truncated, originalChars: content.originalChars, usage,
  })
}
