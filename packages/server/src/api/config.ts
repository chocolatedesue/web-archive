import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { AITagConfig, UrlArchiverConfig } from '@web-archive/shared/types'
import { z } from 'zod'
import type { HonoTypeUserInformation } from '~/constants/binding'
import { getAITagConfig, getShouldShowRecent, getUrlArchiverConfig, setAITagConfig, setShouldShowRecent, setUrlArchiverConfig } from '~/model/store'
import result from '~/utils/result'
import { REDACTED_SECRET } from '~/constants/url-archiver'

const app = new Hono<HonoTypeUserInformation>()

app.get('/should_show_recent', async (c) => {
  try {
    const shouldShowRecent = await getShouldShowRecent(c.env.DB)
    return c.json(result.success(shouldShowRecent))
  }
  catch (error) {
    console.error(error)
    return c.json(result.error(500, 'Failed to get config'))
  }
})

app.post(
  '/should_show_recent',
  validator('json', (value, c) => {
    if (typeof value.shouldShowRecent !== 'boolean') {
      return c.json(result.error(400, 'shouldShowRecent is required'))
    }

    return {
      shouldShowRecent: value.shouldShowRecent as boolean,
    }
  }),
  async (c) => {
    const { shouldShowRecent } = c.req.valid('json')
    try {
      await setShouldShowRecent(c.env.DB, shouldShowRecent)
      return c.json(result.success(shouldShowRecent))
    }
    catch (error) {
      console.error(error)
      return c.json(result.error(500, 'Failed to update config'))
    }
  },
)

app.get('/ai_tag', async (c) => {
  try {
    const aiTagConfig = await getAITagConfig(c.env.DB)
    return c.json(result.success(aiTagConfig))
  }
  catch (error) {
    console.error(error)
    return c.json(result.error(500, 'Failed to get config'))
  }
})

app.post(
  '/ai_tag',
  validator('json', (value, c) => {
    const modelError = {
      message: 'Model name is required',
    }
    const apiUrlError = {
      message: 'API URL is required',
    }
    const apiKeyError = {
      message: 'API Key is required',
    }
    const cloudflareSchema = z.object({
      type: z.literal('cloudflare'),
      tagLanguage: z.enum(['en', 'zh']).default('en'),
      model: z.string(modelError).min(1, modelError),
      preferredTags: z.array(z.string()).default([]),
    })
    const openaiSchema = z.object({
      type: z.literal('openai'),
      tagLanguage: z.enum(['en', 'zh']).default('en'),
      model: z.string(modelError).min(1, modelError),
      preferredTags: z.array(z.string()).default([]),
      apiUrl: z.string(apiUrlError).min(1, apiUrlError),
      apiKey: z.string(apiKeyError).min(1, apiKeyError),
    })

    const schema = z.discriminatedUnion('type', [
      cloudflareSchema,
      openaiSchema,
    ])
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      if (parsed.error.errors.length > 0) {
        return c.json(result.error(400, parsed.error.errors[0].message))
      }
      return c.json(result.error(400, 'Invalid request'))
    }

    // todo set tsconfig strict to avoid type assertion
    return parsed.data as AITagConfig
  }),
  async (c) => {
    const aiTagConfig = c.req.valid('json')
    try {
      await setAITagConfig(c.env.DB, aiTagConfig)
      return c.json(result.success(aiTagConfig))
    }
    catch (error) {
      console.error(error)
      return c.json(result.error(500, 'Failed to update config'))
    }
  },
)

// ──── URL Archiver config ──────────────────────────────────────────

/**
 * Replace any secret field with the redaction sentinel before exposing the
 * config to the client.
 */
function redactUrlArchiverConfig(cfg: UrlArchiverConfig): UrlArchiverConfig {
  const redacted = JSON.parse(JSON.stringify(cfg)) as UrlArchiverConfig
  if (redacted.provider === 'jina-reader' && redacted.apiKey) {
    redacted.apiKey = REDACTED_SECRET
  }
  if (redacted.provider === 'firecrawl' && redacted.apiKey) {
    redacted.apiKey = REDACTED_SECRET
  }
  if (redacted.aiSummary.type === 'openai' && redacted.aiSummary.apiKey) {
    redacted.aiSummary.apiKey = REDACTED_SECRET
  }
  return redacted
}

/**
 * If the incoming config carries the redaction sentinel for any secret field,
 * preserve the previously-stored value instead of overwriting it.
 */
function mergePreservingSecrets(
  incoming: UrlArchiverConfig,
  existing: UrlArchiverConfig,
): UrlArchiverConfig {
  const merged = JSON.parse(JSON.stringify(incoming)) as UrlArchiverConfig

  if (merged.provider === 'jina-reader' && merged.apiKey === REDACTED_SECRET) {
    merged.apiKey = existing.provider === 'jina-reader' ? existing.apiKey : undefined
  }
  if (merged.provider === 'firecrawl' && merged.apiKey === REDACTED_SECRET) {
    merged.apiKey = existing.provider === 'firecrawl' ? existing.apiKey : ''
  }
  if (merged.aiSummary.type === 'openai' && merged.aiSummary.apiKey === REDACTED_SECRET) {
    merged.aiSummary.apiKey
      = existing.aiSummary.type === 'openai' ? existing.aiSummary.apiKey : ''
  }

  return merged
}

const aiSummarySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noop') }),
  z.object({
    type: z.literal('cloudflare'),
    model: z.string().min(1, { message: 'aiSummary.model is required' }),
    language: z.enum(['en', 'zh']).optional(),
    maxChars: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('openai'),
    model: z.string().min(1, { message: 'aiSummary.model is required' }),
    apiKey: z.string().min(1, { message: 'aiSummary.apiKey is required' }),
    apiUrl: z.string().min(1, { message: 'aiSummary.apiUrl is required' }),
    language: z.enum(['en', 'zh']).optional(),
    maxChars: z.number().int().positive().optional(),
  }),
])

const baseFlags = {
  generateSummaryByDefault: z.boolean(),
  generateTagsByDefault: z.boolean(),
  captureScreenshotByDefault: z.boolean(),
  aiSummary: aiSummarySchema,
}

const urlArchiverSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('noop'), ...baseFlags }),
  z.object({ provider: z.literal('raw-fetch'), ...baseFlags }),
  z.object({
    provider: z.literal('jina-reader'),
    apiKey: z.string().optional(),
    ...baseFlags,
  }),
  z.object({ provider: z.literal('cf-browser-rendering'), ...baseFlags }),
  z.object({
    provider: z.literal('firecrawl'),
    apiKey: z.string().min(1, { message: 'apiKey is required' }),
    apiUrl: z.string().optional(),
    ...baseFlags,
  }),
])

app.get('/url_archiver', async (c) => {
  try {
    const cfg = await getUrlArchiverConfig(c.env.DB)
    return c.json(result.success(redactUrlArchiverConfig(cfg)))
  }
  catch (error) {
    console.error(error)
    return c.json(result.error(500, 'Failed to get config'))
  }
})

app.post(
  '/url_archiver',
  validator('json', (value, c) => {
    const parsed = urlArchiverSchema.safeParse(value)
    if (!parsed.success) {
      const message = parsed.error.errors[0]?.message ?? 'Invalid request'
      return c.json(result.error(400, message))
    }
    return parsed.data as UrlArchiverConfig
  }),
  async (c) => {
    const incoming = c.req.valid('json')
    try {
      const existing = await getUrlArchiverConfig(c.env.DB)
      const merged = mergePreservingSecrets(incoming, existing)
      await setUrlArchiverConfig(c.env.DB, merged)
      return c.json(result.success(redactUrlArchiverConfig(merged)))
    }
    catch (error) {
      console.error(error)
      return c.json(result.error(500, 'Failed to update config'))
    }
  },
)

export default app
