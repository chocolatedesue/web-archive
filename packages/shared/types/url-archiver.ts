// ─── Content fetcher ────────────────────────────────────────────────

export type FetcherProviderName =
  | 'auto'
  | 'noop'
  | 'raw-fetch'
  | 'jina-reader'
  | 'cf-browser-rendering'
  | 'firecrawl'

export interface FetchOptions {
  timeoutMs?: number
  captureScreenshot?: boolean
  /** Provider-specific extras forwarded as-is */
  providerOptions?: Record<string, unknown>
}

export interface FetchResultMeta {
  fetchedAt: string // ISO date
  contentType: string
  statusCode: number
  bytes: number
  providerName: string
}

export interface FetchResult {
  finalUrl: string
  title: string
  /** Raw <meta name="description"> content if any. Empty string when absent. */
  metaDescription: string
  /** A self-contained HTML snapshot that the user will see when opening the page. */
  htmlContent: string
  /** Plain text or markdown extracted from the page; used as input to the AI summary. */
  textContent: string
  /** webp/png bytes; the orchestrator stores these in R2. */
  screenshot?: ArrayBuffer
  meta: FetchResultMeta
}

export interface ContentFetcher {
  readonly name: Exclude<FetcherProviderName, 'auto'>
  fetch: (url: string, options?: FetchOptions) => Promise<FetchResult>
}

// ─── AI enhancer ────────────────────────────────────────────────────

export type AIEnhancerProviderName = 'noop' | 'cloudflare' | 'openai'

export type AIEnhancerConfig =
  | { type: 'noop' }
  | {
    type: 'cloudflare'
    model: string
    language?: 'en' | 'zh'
    maxChars?: number
  }
  | {
    type: 'openai'
    model: string
    apiKey: string
    apiUrl: string
    language?: 'en' | 'zh'
    maxChars?: number
  }

export interface SummaryInput {
  title: string
  url: string
  textContent: string
  language?: 'en' | 'zh'
  maxChars?: number
}

export interface AIEnhancer {
  readonly name: AIEnhancerProviderName
  /** Returns a short description suitable for `pageDesc` (≈ 200 chars). */
  summarize: (input: SummaryInput) => Promise<string>
  /** Optional. If undefined, the orchestrator falls back to no auto-tags. */
  suggestTags?: (input: SummaryInput) => Promise<string[]>
}

// ─── URL archiver config (persisted in `stores` table) ──────────────

export interface BaseUrlArchiverConfig {
  generateSummaryByDefault: boolean
  generateTagsByDefault: boolean
  captureScreenshotByDefault: boolean
  aiSummary: AIEnhancerConfig
}

export type UrlArchiverConfig =
  | (BaseUrlArchiverConfig & { provider: 'noop' })
  | (BaseUrlArchiverConfig & { provider: 'raw-fetch' })
  | (BaseUrlArchiverConfig & { provider: 'jina-reader', apiKey?: string })
  | (BaseUrlArchiverConfig & { provider: 'cf-browser-rendering' })
  | (BaseUrlArchiverConfig & { provider: 'firecrawl', apiKey: string, apiUrl?: string })

// ─── Orchestrator I/O ───────────────────────────────────────────────

export interface ArchiveByUrlOptions {
  fetcherProvider?: FetcherProviderName
  generateSummary?: boolean
  generateTags?: boolean
  captureScreenshot?: boolean
}

export interface ArchiveByUrlInput {
  url: string
  folderId: number
  titleOverride?: string
  pageDescOverride?: string
  bindTags?: string[]
  isShowcased?: boolean
  options?: ArchiveByUrlOptions
}

export type ArchiveByUrlOutput =
  | {
    status: 'created'
    pageId: number
    title: string
    pageDesc: string
    fetcherUsed: string
  }
  | { status: 'duplicate', pageId: number }
  | { status: 'error', code: string, message: string }

export interface PreviewUrlInput {
  url: string
  fetcherProvider?: FetcherProviderName
}

export interface PreviewUrlOutput {
  finalUrl: string
  title: string
  metaDescription: string
  /** Up to 2000 chars of extracted text */
  textSample: string
  hasScreenshot: boolean
  fetcherUsed: string
  bytes: number
  fetchedAt: string
}
