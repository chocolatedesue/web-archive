import type { FetcherProviderName, UrlArchiverConfig } from '@web-archive/shared/types'

/** Sentinel returned in GET responses in place of secret values. */
export const REDACTED_SECRET = '***'

/** Default per-fetcher wall-clock budget. CF Worker free tier ≈ 30s. */
export const DEFAULT_FETCHER_TIMEOUT_MS = 25_000

/** Storage guards (orchestrator-level). */
export const MAX_HTML_BYTES = 10 * 1024 * 1024 // 10 MiB
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024 // 2 MiB

/** How much extracted text we expose in the preview endpoint. */
export const PREVIEW_TEXT_SAMPLE_CHARS = 2000

/** Maximum length of an AI-generated `pageDesc`. */
export const SUMMARY_DEFAULT_MAX_CHARS = 200

/** Provider names known to the server. Stays in sync with FetcherProviderName. */
export const FETCHER_PROVIDER_NAMES = [
  'auto',
  'noop',
  'raw-fetch',
  'jina-reader',
  'cf-browser-rendering',
  'firecrawl',
] as const satisfies readonly FetcherProviderName[]

/** Default configuration when nothing has been written yet. */
export const DEFAULT_URL_ARCHIVER_CONFIG: UrlArchiverConfig = {
  provider: 'raw-fetch',
  generateSummaryByDefault: false,
  generateTagsByDefault: false,
  captureScreenshotByDefault: false,
  aiSummary: { type: 'noop' },
}
