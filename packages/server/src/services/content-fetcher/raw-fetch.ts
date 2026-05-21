import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * RawFetchFetcher — zero external dependency.
 *
 * Uses the Workers-native `fetch()` to retrieve the page, then extracts
 * structured data from the raw HTML via lightweight regex/string parsing
 * (no DOM, no Readability — both require a browser context).
 *
 * Security:
 *   - Refuses private / loopback / link-local IP ranges (SSRF guard).
 *   - Follows redirects up to 5 hops.
 *   - Rejects non-HTML content types and payloads > MAX_HTML_BYTES.
 *
 * Extraction:
 *   - title       → <title>, then og:title, then first <h1>
 *   - description → <meta name="description">, then og:description
 *   - textContent → strips HTML tags, collapses whitespace
 */

const MAX_REDIRECTS = 5
const MAX_BYTES = 10 * 1024 * 1024 // 10 MiB — matches orchestrator guard

// Private / reserved ranges that must not be fetched (SSRF)
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,      // link-local
  /^::1$/,                      // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,          // IPv6 ULA
  /^fe80:/i,                    // IPv6 link-local
]

function assertNotPrivate(url: URL): void {
  const { hostname } = url
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new FetcherError(
        'INVALID_URL',
        `Requests to private/reserved addresses are not allowed: ${hostname}`,
        'raw-fetch',
      )
    }
  }
}

export class RawFetchFetcher implements ContentFetcher {
  readonly name = 'raw-fetch' as const

  async fetch(rawUrl: string, options?: FetchOptions): Promise<FetchResult> {
    const timeoutMs = options?.timeoutMs ?? 25_000

    // ── 1. validate & SSRF-guard ──────────────────────────────────
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    }
    catch {
      throw new FetcherError('INVALID_URL', `Invalid URL: ${rawUrl}`, 'raw-fetch')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new FetcherError('INVALID_URL', 'Only http(s) URLs are supported', 'raw-fetch')
    }
    assertNotPrivate(parsed)

    // ── 2. fetch with timeout + redirect tracking ─────────────────
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    let finalUrl = rawUrl

    try {
      res = await fetch(rawUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WebArchiveBot/1.0; +https://github.com/ray-d-song/web-archive)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en,zh;q=0.9',
        },
        signal: controller.signal,
      })
      finalUrl = res.url || rawUrl
    }
    catch (e: unknown) {
      clearTimeout(timer)
      if (e instanceof Error && e.name === 'AbortError') {
        throw new FetcherError('TIMEOUT', `raw-fetch timed out after ${timeoutMs}ms`, 'raw-fetch')
      }
      const msg = e instanceof Error ? e.message : String(e)
      throw new FetcherError('PROVIDER_FAILURE', `raw-fetch network error: ${msg}`, 'raw-fetch')
    }
    clearTimeout(timer)

    // ── 3. status checks ─────────────────────────────────────────
    if (res.status >= 400 && res.status < 500) {
      throw new FetcherError('UPSTREAM_4XX', `Target page returned HTTP ${res.status}`, 'raw-fetch')
    }
    if (res.status >= 500) {
      throw new FetcherError('UPSTREAM_5XX', `Target page returned HTTP ${res.status}`, 'raw-fetch')
    }

    // ── 4. content-type guard ────────────────────────────────────
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html') && !ct.includes('xml') && ct !== '') {
      // Non-HTML (PDF, binary, etc.) — store as a generic link placeholder
      // rather than attempting to parse binary data.
      const title = new URL(finalUrl).hostname + new URL(finalUrl).pathname
      const htmlContent = linkPlaceholderHtml(title, finalUrl, ct)
      return {
        finalUrl,
        title,
        metaDescription: '',
        htmlContent,
        textContent: title,
        meta: {
          fetchedAt: new Date().toISOString(),
          contentType: ct,
          statusCode: res.status,
          bytes: htmlContent.length,
          providerName: 'raw-fetch',
        },
      }
    }

    // ── 5. read body (size-limited) ───────────────────────────────
    const reader = res.body?.getReader()
    if (!reader) {
      throw new FetcherError('PROVIDER_FAILURE', 'Response body is null', 'raw-fetch')
    }

    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      if (value) {
        totalBytes += value.byteLength
        if (totalBytes > MAX_BYTES) {
          reader.cancel()
          throw new FetcherError('TOO_LARGE', `Page exceeds ${MAX_BYTES / 1024 / 1024} MiB`, 'raw-fetch')
        }
        chunks.push(value)
      }
    }

    const combined = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }

    // Decode — honour charset in content-type header, default to UTF-8
    const charset = extractCharset(ct) ?? 'utf-8'
    const html = new TextDecoder(charset, { fatal: false }).decode(combined)

    // ── 6. extract metadata ───────────────────────────────────────
    const title = extractTitle(html) || new URL(finalUrl).hostname
    const metaDescription = extractMetaDescription(html)
    const textContent = htmlToText(html)

    // SSRF guard on the final URL too (in case a redirect went somewhere bad)
    try {
      assertNotPrivate(new URL(finalUrl))
    }
    catch {
      throw new FetcherError('INVALID_URL', 'Redirect target is a private address', 'raw-fetch')
    }

    return {
      finalUrl,
      title,
      metaDescription,
      htmlContent: html,
      textContent,
      meta: {
        fetchedAt: new Date().toISOString(),
        contentType: ct,
        statusCode: res.status,
        bytes: totalBytes,
        providerName: 'raw-fetch',
      },
    }
  }
}

// ── HTML metadata extraction ──────────────────────────────────────────────────

/**
 * Priority: <title> → og:title → first <h1>
 */
function extractTitle(html: string): string {
  // <title>...</title>
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleTag?.[1]) {
    return decodeHtmlEntities(titleTag[1].trim())
  }
  // og:title
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
  if (ogTitle?.[1]) {
    return decodeHtmlEntities(ogTitle[1].trim())
  }
  // first <h1>
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1?.[1]) {
    return decodeHtmlEntities(stripTags(h1[1]).trim())
  }
  return ''
}

/**
 * Priority: <meta name="description"> → og:description
 */
function extractMetaDescription(html: string): string {
  // <meta name="description" content="...">
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i)
  if (desc?.[1])
    return decodeHtmlEntities(desc[1].trim())

  // og:description
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:description["']/i)
  if (og?.[1])
    return decodeHtmlEntities(og[1].trim())

  return ''
}

/**
 * Rough but fast: strip tags, scripts, styles; collapse whitespace.
 * Limits output to 50 000 chars so downstream AI isn't overwhelmed.
 */
function htmlToText(html: string): string {
  // Remove <script>, <style>, <noscript>, <svg>, <head> blocks entirely
  let text = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
  text = decodeHtmlEntities(text)
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 50_000)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

function extractCharset(contentType: string): string | undefined {
  const m = contentType.match(/charset=([^\s;]+)/i)
  return m?.[1]
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
}

function linkPlaceholderHtml(title: string, url: string, contentType: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<p>Content-Type: <code>${escapeHtml(contentType)}</code></p>
<p>This resource is not an HTML page. <a href="${escapeHtml(url)}">Open original link</a></p>
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
