const string = { type: 'string' }
const number = { type: 'number' }
const required = schema => ({ ...schema, required: true })
const usage = {
  type: 'object', required: true, additionalProperties: false,
  properties: {
    attempts: required({ type: 'integer' }), requestId: string, credits: number,
    costDollars: number, responseTimeSeconds: number, searchTimeMilliseconds: number,
  },
}
const common = { provider: required(string), truncated: required({ type: 'boolean' }), usage }
export const searchOutput = {
  type: 'object', additionalProperties: false,
  properties: {
    ...common,
    results: {
      type: 'array', required: true,
      items: { type: 'object', additionalProperties: false, properties: {
        provider: required(string), title: required(string), url: required(string), snippet: required(string), publishedAt: string,
        truncated: required({ type: 'boolean' }), originalChars: required({ type: 'integer' }),
      } },
    },
    warning: string,
  },
}
export const fetchOutput = {
  type: 'object', additionalProperties: false,
  properties: {
    ...common, title: required(string), url: required(string), content: required(string), format: required(string),
    publishedAt: string, originalChars: required({ type: 'integer' }),
  },
}

export function renderSearch(_args, value) {
  const sections = [`Provider: ${value.provider} | Usage: ${JSON.stringify(value.usage)}`]
  for (const row of value.results) {
    sections.push(`[${row.title || row.url}](${row.url})${row.publishedAt ? ` — ${row.publishedAt}` : ''}\n${row.snippet}${row.truncated ? '\n[Snippet truncated]' : ''}`)
  }
  if (!value.results.length) sections.push('No results found.')
  if (value.warning) sections.push(value.warning)
  if (value.truncated) sections.push('[Results truncated by configured limits; use web_fetch or refine the query.]')
  return [{ type: 'text', text: sections.join('\n\n') }]
}

export function renderFetch(_args, value) {
  return [{ type: 'text', text: `[${value.title || value.url}](${value.url})\nProvider: ${value.provider} | Usage: ${JSON.stringify(value.usage)}\n\n${value.content}${value.truncated ? '\n\n[Page content truncated by configured limit.]' : ''}` }]
}
