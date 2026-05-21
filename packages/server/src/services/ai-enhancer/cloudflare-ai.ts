import type { AIEnhancerConfig } from '@web-archive/shared/types'
import type { AIEnhancer, SummaryInput } from './types'
import { AIEnhancerError } from './types'
import type { Bindings } from '~/constants/binding'
import { SUMMARY_DEFAULT_MAX_CHARS } from '~/constants/url-archiver'

type CloudflareAICfg = Extract<AIEnhancerConfig, { type: 'cloudflare' }>

/**
 * Builds the messages array for a summarise request.
 * Mirrors `buildGenerateTagMessage` in packages/shared/utils/ai.ts.
 */
function buildSummaryMessages(input: SummaryInput, maxChars: number) {
  const lang = input.language === 'zh' ? 'Chinese' : 'English'
  const system = `You are a concise page summariser. \
Given a web page title and its extracted text content, write a single-paragraph \
description of at most ${maxChars} characters in ${lang}. \
Return ONLY the description text — no JSON, no markdown, no extra commentary.`

  // Trim textContent so we don't overflow the model's context window.
  // Most CF AI models have a 4096-token input limit; 3000 chars ≈ safe budget.
  const snippet = (input.textContent ?? '').slice(0, 3000)
  const user = `Title: ${input.title}\n\nURL: ${input.url}\n\nContent:\n${snippet}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

function buildTagMessages(input: SummaryInput) {
  const lang = input.language === 'zh' ? 'chinese' : 'english'
  const system = `What tags would you give to the input content? Please follow these rules:
    1. Use ${lang} for most tags
    2. Keep common technical terms and abbreviations as-is
    3. Keep brand names in their original form
    4. Tags should be keywords, not explanations
    5. Return format must be: {"tags": ["tag1", "tag2", ...]}
    6. Do not return any explanatory text
    7. Keep tags concise. Return no more than 5 tags in total`

  const snippet = (input.textContent ?? '').slice(0, 3000)
  const user = JSON.stringify({ title: input.title, pageDesc: snippet })

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

export class CloudflareAIEnhancer implements AIEnhancer {
  readonly name = 'cloudflare' as const

  private readonly model: string
  private readonly maxChars: number

  constructor(
    private readonly env: Bindings,
    cfg: CloudflareAICfg,
  ) {
    if (!cfg.model) {
      throw new AIEnhancerError(
        'PROVIDER_FAILURE',
        'Cloudflare AI model name is not configured',
        'cloudflare',
      )
    }
    this.model = cfg.model
    this.maxChars = cfg.maxChars ?? SUMMARY_DEFAULT_MAX_CHARS
  }

  async summarize(input: SummaryInput): Promise<string> {
    const messages = buildSummaryMessages(input, input.maxChars ?? this.maxChars)

    let res: unknown
    try {
      res = await this.env.AI.run(
        // @ts-expect-error dynamic model name, same pattern as tags.ts
        this.model,
        { messages },
      )
    }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new AIEnhancerError('PROVIDER_FAILURE', `Cloudflare AI error: ${msg}`, 'cloudflare')
    }

    if (res instanceof ReadableStream) {
      throw new AIEnhancerError(
        'INVALID_RESPONSE',
        'Cloudflare AI returned a stream — enable non-streaming mode or pick a different model',
        'cloudflare',
      )
    }

    const text = extractTextFromCfResponse(res)
    if (!text) {
      throw new AIEnhancerError(
        'INVALID_RESPONSE',
        'Cloudflare AI returned an empty response',
        'cloudflare',
      )
    }

    return text.slice(0, input.maxChars ?? this.maxChars)
  }

  async suggestTags(input: SummaryInput): Promise<string[]> {
    const messages = buildTagMessages(input)

    let res: unknown
    try {
      res = await this.env.AI.run(
        // @ts-expect-error dynamic model name
        this.model,
        { messages },
      )
    }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new AIEnhancerError('PROVIDER_FAILURE', `Cloudflare AI error: ${msg}`, 'cloudflare')
    }

    if (res instanceof ReadableStream) {
      return []
    }

    const text = extractTextFromCfResponse(res)
    return parseTagsFromText(text)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Cloudflare AI responses look like `{ response: string }` for text-gen models.
 */
function extractTextFromCfResponse(res: unknown): string {
  if (typeof res === 'string')
    return res.trim()
  if (res && typeof res === 'object' && 'response' in res) {
    const r = (res as { response: unknown }).response
    if (typeof r === 'string')
      return r.trim()
  }
  return ''
}

function parseTagsFromText(text: string): string[] {
  try {
    // Try to find a JSON object anywhere in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed.tags)) {
        return (parsed.tags as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .slice(0, 5)
      }
    }
  }
  catch {
    // fall through
  }
  return []
}
