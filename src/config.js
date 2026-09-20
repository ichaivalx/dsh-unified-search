import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const PROVIDERS = ['tavily', 'exa', 'firecrawl']
const enumOf = (values, fallback) => z.union(values).default(fallback)
const optionalLimit = () => z.union([z.number(), z.const(null)]).default(null)
const common = (ref, searchTimeoutMs) => ({
  keys: z.array(z.object({ ref: z.string().required(), enabled: z.boolean().default(true) })).default([{ ref, enabled: true }]),
  keyStrategy: enumOf(['round-robin', 'failover'], 'round-robin'),
  searchTimeoutMs: z.number().default(searchTimeoutMs),
  fetchTimeoutMs: z.number().default(90000),
  maxResults: optionalLimit(),
  snippetMaxChars: optionalLimit(),
  fetchMaxChars: optionalLimit(),
})

/** All deployment budgets live in settings; the model sees only task parameters. */
export const SettingsSchema = z.object({
  defaultSearchProvider: enumOf(PROVIDERS, 'tavily'),
  defaultFetchProvider: enumOf(PROVIDERS, 'firecrawl'),
  providers: z.object({
    tavily: z.object({
      ...common('TAVILY_API_KEY', 90000),
      searchDepth: enumOf(['basic', 'advanced', 'fast', 'ultra-fast'], 'advanced'),
      topic: enumOf(['general', 'news', 'finance'], 'general'),
      extractDepth: enumOf(['basic', 'advanced'], 'advanced'),
      extractTimeoutSeconds: z.number().default(60),
    }).default({}),
    exa: z.object({
      ...common('EXA_API_KEY', 180000),
      searchType: enumOf(['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'], 'deep-reasoning'),
      searchContent: enumOf(['highlights', 'text'], 'highlights'),
      maxAgeHours: z.number().default(24),
    }).default({}),
    firecrawl: z.object({
      ...common('FIRECRAWL_API_KEY', 90000),
      searchApiTimeoutMs: z.number().default(60000),
      scrapeApiTimeoutMs: z.number().default(60000),
      highlights: z.boolean().default(true),
      onlyMainContent: z.boolean().default(true),
    }).default({}),
  }).default({}),
})

export function validateSettings(settings) {
  for (const provider of PROVIDERS) {
    const config = settings.providers[provider]
    for (const field of ['searchTimeoutMs', 'fetchTimeoutMs']) {
      if (!Number.isSafeInteger(config[field]) || config[field] < 1) throw new Error(`unified-search: ${provider}.${field} must be a positive safe integer`)
    }
    for (const field of ['snippetMaxChars', 'fetchMaxChars']) {
      if (config[field] != null && (!Number.isSafeInteger(config[field]) || config[field] < 1)) throw new Error(`unified-search: ${provider}.${field} must be empty or a positive safe integer`)
    }
    const maximum = provider === 'tavily' ? 20 : 100
    const minimum = provider === 'tavily' ? 0 : 1
    if (config.maxResults != null && (!Number.isInteger(config.maxResults) || config.maxResults < minimum || config.maxResults > maximum)) throw new Error(`unified-search: ${provider}.maxResults must be empty or between ${minimum} and ${maximum} (API limit)`)
    const seen = new Set()
    for (const key of config.keys) {
      credentialRef(key.ref)
      if (seen.has(key.ref)) throw new Error(`unified-search: duplicate credential reference in ${provider}.keys`)
      seen.add(key.ref)
    }
  }
  const seconds = settings.providers.tavily.extractTimeoutSeconds
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('unified-search: Tavily extractTimeoutSeconds must be between 1 and 60 (API limit)')
  const age = settings.providers.exa.maxAgeHours
  if (!Number.isInteger(age) || age < -1 || age > 720) throw new Error('unified-search: exa.maxAgeHours must be an integer from -1 to 720 (API limit)')
  for (const field of ['searchApiTimeoutMs', 'scrapeApiTimeoutMs']) {
    const value = settings.providers.firecrawl[field]
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`unified-search: firecrawl.${field} must be a positive safe integer`)
  }
}

export const defaultConfig = SettingsSchema({})
