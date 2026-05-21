import type { UrlArchiverConfig } from '@web-archive/shared/types'
import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * Jina Reader provider — prepends `https://r.jina.ai/` to any URL and
 * receives clean Markdown back.
 *
 * Docs: https://jina.ai/reader
 *
 * Key response headers Jina exposes (via X-* headers):
 *   X-Title          — page title
 *   X-Description    — meta description
 *   X-Url            — final (post-redirect) URL
 *
 * Auth is optional: Jina works without a key (rate-limited).
 * Pass `Authorization: Bearer <apiKey>` to get higher rate limits.
 *
 * We request JSON mode (`Accept: application/json`) so title / description /
 * url come back structured rather than having to parse headers.
 */

interface JinaJsonResponse {
  code: number
  status: number
  data?: {
    title?: string
    description?: string
    url?: string
    content?: string   // markdown body
  }
}

type JinaConfig = Extract<UrlArchiverConfig, { provider: 'jina-reader' }>

const JINA_BASE = 'https://r.jina.ai'

export class JinaReaderFetcher implements ContentFetcher {
  readonly name = 'jina-reader' as const

  private readonly apiKey: string | undefined

  constructor(cfg: UrlArchiverConfig) {
    const jina = cfg as JinaConfig
    this.apiKey = jina.apiKey || undefined
  }

  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    const timeoutMs = options?.timeoutMs ?? 25_000

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'X-Return-Format': 'markdown',
      // ask Jina to also return the final URL and meta
      'X-With-Links-Summary': 'false',
      'X-With-Images-Summary': 'false',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch(`${JINA_BASE}/${url}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
    }
    catch (e: unknown) {
      clearTimeout(timer)
      if (e instanceof Error && e.name === 'AbortError') {
        throw new FetcherError('TIMEOUT', `Jina Reader timed out after ${timeoutMs}ms`, 'jina-reader')
      }
      const msg = e instanceof Error ? e.message : String(e)
      throw new FetcherError('PROVIDER_FAILURE', `Jina Reader fetch error: ${msg}`, 'jina-reader')
    }
    clearTimeout(timer)

    if (res.status === 401 || res.status === 403) {
      throw new FetcherError('PROVIDER_FAILURE', `Jina Reader auth failed (${res.status}) — check your apiKey`, 'jina-reader')
    }
    if (res.status === 429) {
      throw new FetcherError('PROVIDER_FAILURE', 'Jina Reader rate limit exceeded — add an API key for higher limits', 'jina-reader')
    }
    if (res.status >= 400 && res.status < 500) {
      throw new FetcherError('UPSTREAM_4XX', `Jina Reader returned ${res.status} for the target URL`, 'jina-reader')
    }
    if (res.status >= 500) {
      throw new FetcherError('UPSTREAM_5XX', `Jina Reader returned ${res.status}`, 'jina-reader')
    }

    // ── parse response ──────────────────────────────────────────────

    // Try JSON mode first; fall back to plain text (older API behaviour)
    let markdown = ''
    let title = ''
    let metaDescription = ''
    let finalUrl = url

    const contentType = res.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      let body: JinaJsonResponse
      try {
        body = await res.json() as JinaJsonResponse
      }
      catch {
        throw new FetcherError('PROVIDER_FAILURE', 'Jina Reader returned invalid JSON', 'jina-reader')
      }
      if (!body.data) {
        throw new FetcherError('PROVIDER_FAILURE', `Jina Reader error code ${body.code}`, 'jina-reader')
      }
      markdown = body.data.content ?? ''
      title = body.data.title ?? ''
      metaDescription = body.data.description ?? ''
      finalUrl = body.data.url ?? url
    }
    else {
      // plain-text / markdown fallback — extract title from first H1 line
      markdown = await res.text()
      // Jina plain-text responses start with "Title: ..." and "URL Source: ..."
      title = extractJinaPlainTitle(markdown) ?? new URL(url).hostname
      metaDescription = extractJinaPlainDescription(markdown) ?? ''
      finalUrl = extractJinaPlainUrl(markdown) ?? url
    }

    if (!markdown) {
      throw new FetcherError('PROVIDER_FAILURE', 'Jina Reader returned empty content', 'jina-reader')
    }

    // ── build HTML snapshot ──────────────────────────────────────────
    const htmlContent = markdownToMinimalHtml(markdown, title, finalUrl)
    const bytes = new TextEncoder().encode(htmlContent).byteLength

    return {
      finalUrl,
      title: title || new URL(url).hostname,
      metaDescription,
      htmlContent,
      textContent: markdown,
      // Jina does not return screenshots
      meta: {
        fetchedAt: new Date().toISOString(),
        contentType: 'text/html; charset=utf-8',
        statusCode: res.status,
        bytes,
        providerName: 'jina-reader',
      },
    }
  }
}

// ── plain-text header parsers ─────────────────────────────────────────────────
// Jina plain responses look like:
//   Title: Page Title
//   URL Source: https://...
//   Published Time: ...
//   ...blank line...
//   Markdown content ...

function extractJinaPlainTitle(text: string): string | undefined {
  const m = text.match(/^Title:\s*(.+)$/m)
  return m?.[1]?.trim()
}

function extractJinaPlainDescription(text: string): string | undefined {
  const m = text.match(/^Description:\s*(.+)$/m)
  return m?.[1]?.trim()
}

function extractJinaPlainUrl(text: string): string | undefined {
  const m = text.match(/^URL Source:\s*(.+)$/m)
  return m?.[1]?.trim()
}

// ── minimal HTML wrapper ──────────────────────────────────────────────────────

function markdownToMinimalHtml(markdown: string, title: string, sourceUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="source-url" content="${escapeHtml(sourceUrl)}">
<style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.7}
pre,code{background:#f4f4f4;border-radius:3px}
pre{padding:1rem;overflow:auto}
code{padding:.15em .3em}
img{max-width:100%}
</style>
</head>
<body>
<article>
<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(markdown)}</pre>
</article>
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
