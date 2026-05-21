import type { ContentFetcher, FetchOptions, FetchResult } from './types'

/**
 * Deterministic, network-free fetcher used for tests and to allow the
 * end-to-end archive flow to be exercised before any real provider is wired up.
 *
 * Returns a tiny synthetic snapshot derived from the URL so the orchestrator
 * has every field populated.
 */
export class NoopFetcher implements ContentFetcher {
  readonly name = 'noop' as const

  async fetch(url: string, _options?: FetchOptions): Promise<FetchResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    }
    catch {
      throw new Error('NoopFetcher: invalid URL')
    }

    const title = parsed.hostname + parsed.pathname
    const metaDescription = `Synthetic snapshot for ${parsed.href}`
    const textContent = `${title}\n\n${metaDescription}\n`
    const htmlContent
      = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
      + `<meta name="description" content="${escapeHtml(metaDescription)}"></head>`
      + `<body><h1>${escapeHtml(title)}</h1>`
      + `<p>${escapeHtml(metaDescription)}</p>`
      + `<p>Source: <a href="${escapeHtml(parsed.href)}">${escapeHtml(parsed.href)}</a></p>`
      + `</body></html>`

    const bytes = new TextEncoder().encode(htmlContent).byteLength
    return {
      finalUrl: parsed.href,
      title,
      metaDescription,
      htmlContent,
      textContent,
      meta: {
        fetchedAt: new Date().toISOString(),
        contentType: 'text/html; charset=utf-8',
        statusCode: 200,
        bytes,
        providerName: 'noop',
      },
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
