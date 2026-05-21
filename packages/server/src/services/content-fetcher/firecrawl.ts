import FirecrawlApp from '@mendable/firecrawl-js'
import type { UrlArchiverConfig } from '@web-archive/shared/types'
import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

type FirecrawlConfig = Extract<UrlArchiverConfig, { provider: 'firecrawl' }>

export class FirecrawlFetcher implements ContentFetcher {
  readonly name = 'firecrawl' as const

  private readonly app: FirecrawlApp

  constructor(cfg: UrlArchiverConfig) {
    const fc = cfg as FirecrawlConfig
    if (!fc.apiKey) {
      throw new FetcherError('PROVIDER_FAILURE', 'Firecrawl apiKey is not configured', 'firecrawl')
    }
    this.app = new FirecrawlApp({
      apiKey: fc.apiKey,
      ...(fc.apiUrl ? { apiUrl: fc.apiUrl } : {}),
    })
  }

  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    const wantScreenshot = options?.captureScreenshot ?? false
    const formats: ('markdown' | 'html' | 'screenshot')[] = ['markdown', 'html']
    if (wantScreenshot)
      formats.push('screenshot')

    let res: Awaited<ReturnType<typeof this.app.v1.scrapeUrl>>
    try {
      res = await this.app.v1.scrapeUrl(url, { formats })
    }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new FetcherError('PROVIDER_FAILURE', `Firecrawl error: ${msg}`, 'firecrawl')
    }

    if (!res.success) {
      throw new FetcherError('PROVIDER_FAILURE', `Firecrawl error: ${(res as any).error ?? 'unknown'}`, 'firecrawl')
    }

    const markdown = res.markdown ?? ''
    const html = res.html ?? ''
    const meta = res.metadata ?? {}

    const title = (meta.title as string | undefined) ?? new URL(url).hostname
    const metaDescription = (meta.description as string | undefined) ?? ''
    const finalUrl = (meta.sourceURL as string | undefined) ?? url

    const htmlContent = html || markdownToMinimalHtml(markdown, title, finalUrl)
    const textContent = markdown || htmlContent
    const bytes = new TextEncoder().encode(htmlContent).byteLength

    let screenshot: ArrayBuffer | undefined
    if (wantScreenshot && res.screenshot) {
      screenshot = dataUrlToArrayBuffer(res.screenshot)
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
        statusCode: (meta.statusCode as number | undefined) ?? 200,
        bytes,
        providerName: 'firecrawl',
      },
    }
  }
}

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
