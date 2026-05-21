import type { UrlArchiverConfig } from '@web-archive/shared/types'
import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * Firecrawl provider — calls the REST `/v2/scrape` endpoint.
 *
 * Supports both the cloud service (https://api.firecrawl.dev) and any
 * self-hosted instance by setting `apiUrl` in the config.
 *
 * Docs: https://docs.firecrawl.dev/api-reference/endpoint/scrape
 *
 * What we request:
 *   formats: ["markdown", "html"]          — markdown for textContent, html for storage
 *   screenshot: true (when captureScreenshot)
 *   onlyMainContent: true                  — strips nav/footer noise
 *   timeout: per-call budget in ms
 */

interface FirecrawlScrapeResponse {
  success: boolean
  data?: {
    markdown?: string
    html?: string
    screenshot?: string       // base64 data-url "data:image/png;base64,..."
    metadata?: {
      title?: string
      description?: string
      sourceURL?: string
      statusCode?: number
      [key: string]: unknown
    }
  }
  error?: string
}

type FirecrawlConfig = Extract<UrlArchiverConfig, { provider: 'firecrawl' }>

export class FirecrawlFetcher implements ContentFetcher {
  readonly name = 'firecrawl' as const

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(cfg: UrlArchiverConfig) {
    const fc = cfg as FirecrawlConfig
    if (!fc.apiKey) {
      throw new FetcherError('PROVIDER_FAILURE', 'Firecrawl apiKey is not configured', 'firecrawl')
    }
    this.apiKey = fc.apiKey
    this.baseUrl = (fc.apiUrl ?? 'https://api.firecrawl.dev').replace(/\/$/, '')
  }

  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    const timeoutMs = options?.timeoutMs ?? 25_000
    const wantScreenshot = options?.captureScreenshot ?? false

    const formats: string[] = ['markdown', 'html']
    if (wantScreenshot)
      formats.push('screenshot')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/v2/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats,
          onlyMainContent: true,
          timeout: Math.floor(timeoutMs / 1000),
        }),
        signal: controller.signal,
      })
    }
    catch (e: unknown) {
      clearTimeout(timer)
      if (e instanceof Error && e.name === 'AbortError') {
        throw new FetcherError('TIMEOUT', `Firecrawl request timed out after ${timeoutMs}ms`, 'firecrawl')
      }
      const msg = e instanceof Error ? e.message : String(e)
      throw new FetcherError('PROVIDER_FAILURE', `Firecrawl fetch error: ${msg}`, 'firecrawl')
    }
    clearTimeout(timer)

    if (res.status === 401 || res.status === 403) {
      throw new FetcherError('PROVIDER_FAILURE', `Firecrawl auth failed (${res.status}) — check your apiKey`, 'firecrawl')
    }
    if (res.status >= 400 && res.status < 500) {
      throw new FetcherError('UPSTREAM_4XX', `Firecrawl returned ${res.status}`, 'firecrawl')
    }
    if (res.status >= 500) {
      throw new FetcherError('UPSTREAM_5XX', `Firecrawl returned ${res.status}`, 'firecrawl')
    }

    let body: FirecrawlScrapeResponse
    try {
      body = await res.json() as FirecrawlScrapeResponse
    }
    catch {
      throw new FetcherError('PROVIDER_FAILURE', 'Firecrawl returned non-JSON response', 'firecrawl')
    }

    if (!body.success || !body.data) {
      throw new FetcherError('PROVIDER_FAILURE', `Firecrawl error: ${body.error ?? 'unknown'}`, 'firecrawl')
    }

    const { data } = body
    const markdown = data.markdown ?? ''
    const html = data.html ?? ''
    const meta = data.metadata ?? {}

    const title = meta.title ?? new URL(url).hostname
    const metaDescription = meta.description ?? ''
    const finalUrl = (meta.sourceURL as string | undefined) ?? url

    // Build a self-contained HTML snapshot to store in R2.
    // Prefer the raw HTML Firecrawl returned; fall back to a markdown wrapper.
    const htmlContent = html || markdownToMinimalHtml(markdown, title, finalUrl)

    const textContent = markdown || htmlContent

    const bytes = new TextEncoder().encode(htmlContent).byteLength

    // Decode screenshot if present (data:image/png;base64,...)
    let screenshot: ArrayBuffer | undefined
    if (wantScreenshot && data.screenshot) {
      screenshot = dataUrlToArrayBuffer(data.screenshot)
    }

    return {
      finalUrl,
      title,
      metaDescription,
      htmlContent,
      textContent,
      screenshot,
      meta: {
        fetchedAt: new Date().toISOString(),
        contentType: 'text/html; charset=utf-8',
        statusCode: meta.statusCode ?? 200,
        bytes,
        providerName: 'firecrawl',
      },
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function markdownToMinimalHtml(markdown: string, title: string, sourceUrl: string): string {
  const escaped = escapeHtml(markdown)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="source-url" content="${escapeHtml(sourceUrl)}">
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}pre{background:#f4f4f4;padding:1rem;overflow:auto}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<pre style="white-space:pre-wrap">${escaped}</pre>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | undefined {
  try {
    const comma = dataUrl.indexOf(',')
    if (comma === -1)
      return undefined
    const base64 = dataUrl.slice(comma + 1)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
  catch {
    return undefined
  }
}
