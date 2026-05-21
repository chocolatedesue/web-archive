import type { AIEnhancerConfig } from '@web-archive/shared/types'
import { SUMMARY_DEFAULT_MAX_CHARS } from '~/constants/url-archiver'
import type { AIEnhancer, SummaryInput } from './types'
import { AIEnhancerError } from './types'

type OpenAICfg = Extract<AIEnhancerConfig, { type: 'openai' }>

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason?: string
  }>
  error?: {
    message: string
    type?: string
    code?: string
  }
}

function buildSummaryMessages(input: SummaryInput, maxChars: number): ChatMessage[] {
  const lang = input.language === 'zh' ? 'Chinese' : 'English'
  const system = `You are a concise page summariser. \
Given a web page title and its extracted text content, write a single-paragraph \
description of at most ${maxChars} characters in ${lang}. \
Return ONLY the description text — no JSON, no markdown, no extra commentary.`

  const snippet = (input.textContent ?? '').slice(0, 3000)
  const user = `Title: ${input.title}\n\nURL: ${input.url}\n\nContent:\n${snippet}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

function buildTagMessages(input: SummaryInput): ChatMessage[] {
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
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

async function callChatCompletion(
  cfg: OpenAICfg,
  messages: ChatMessage[],
  timeoutMs = 30_000,
): Promise<string> {
  // Normalise base URL: strip trailing slash, append /chat/completions if needed
  const baseUrl = cfg.apiUrl.replace(/\/$/, '')
  const endpoint = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
      }),
      signal: controller.signal,
    })
  }
  catch (e: unknown) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AIEnhancerError('PROVIDER_FAILURE', 'OpenAI request timed out', 'openai')
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new AIEnhancerError('PROVIDER_FAILURE', `OpenAI network error: ${msg}`, 'openai')
  }
  clearTimeout(timer)

  if (res.status === 401 || res.status === 403) {
    throw new AIEnhancerError('PROVIDER_FAILURE', `OpenAI auth failed (${res.status}) — check apiKey`, 'openai')
  }
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try {
      const errBody = await res.json() as ChatCompletionResponse
      if (errBody.error?.message)
        errMsg = errBody.error.message
    }
    catch {}
    throw new AIEnhancerError('PROVIDER_FAILURE', `OpenAI API error: ${errMsg}`, 'openai')
  }

  let data: ChatCompletionResponse
  try {
    data = await res.json() as ChatCompletionResponse
  }
  catch {
    throw new AIEnhancerError('INVALID_RESPONSE', 'OpenAI returned non-JSON response', 'openai')
  }

  if (data.error?.message) {
    throw new AIEnhancerError('PROVIDER_FAILURE', `OpenAI error: ${data.error.message}`, 'openai')
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new AIEnhancerError('INVALID_RESPONSE', 'OpenAI returned empty choices', 'openai')
  }

  return content.trim()
}

export class OpenAICompatibleEnhancer implements AIEnhancer {
  readonly name = 'openai' as const

  private readonly maxChars: number

  constructor(private readonly cfg: OpenAICfg) {
    if (!cfg.apiKey) {
      throw new AIEnhancerError('PROVIDER_FAILURE', 'OpenAI apiKey is not configured', 'openai')
    }
    if (!cfg.apiUrl) {
      throw new AIEnhancerError('PROVIDER_FAILURE', 'OpenAI apiUrl is not configured', 'openai')
    }
    if (!cfg.model) {
      throw new AIEnhancerError('PROVIDER_FAILURE', 'OpenAI model is not configured', 'openai')
    }
    this.maxChars = cfg.maxChars ?? SUMMARY_DEFAULT_MAX_CHARS
  }

  async summarize(input: SummaryInput): Promise<string> {
    const maxChars = input.maxChars ?? this.maxChars
    const messages = buildSummaryMessages({ ...input, language: input.language ?? this.cfg.language }, maxChars)
    const text = await callChatCompletion(this.cfg, messages)
    return text.slice(0, maxChars)
  }

  async suggestTags(input: SummaryInput): Promise<string[]> {
    const messages = buildTagMessages({ ...input, language: input.language ?? this.cfg.language })
    const text = await callChatCompletion(this.cfg, messages)
    return parseTagsFromText(text)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseTagsFromText(text: string): string[] {
  try {
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
