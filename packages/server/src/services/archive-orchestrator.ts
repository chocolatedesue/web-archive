import type {
  ArchiveByUrlInput,
  ArchiveByUrlOutput,
  FetchResult,
  PreviewUrlInput,
  PreviewUrlOutput,
} from '@web-archive/shared/types'
import type { Bindings } from '~/constants/binding'
import {
  DEFAULT_FETCHER_TIMEOUT_MS,
  MAX_HTML_BYTES,
  MAX_SCREENSHOT_BYTES,
  PREVIEW_TEXT_SAMPLE_CHARS,
  SUMMARY_DEFAULT_MAX_CHARS,
} from '~/constants/url-archiver'
import { getUrlArchiverConfig } from '~/model/store'
import { insertPage, queryPageByUrl } from '~/model/page'
import { updateBindPageByTagName } from '~/model/tag'
import { saveFileToBucket } from '~/utils/file'
import { getAIEnhancer } from './ai-enhancer'
import { AIEnhancerError } from './ai-enhancer/types'
import { getContentFetcher } from './content-fetcher'
import { FetcherError } from './content-fetcher/types'

export class OrchestratorError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_URL'
      | 'UPSTREAM_4XX'
      | 'UPSTREAM_5XX'
      | 'TIMEOUT'
      | 'TOO_LARGE'
      | 'NOT_IMPLEMENTED'
      | 'PROVIDER_FAILURE'
      | 'STORAGE'
      | 'DB',
    message: string,
  ) {
    super(message)
    this.name = 'OrchestratorError'
  }
}

/**
 * Map a FetcherError into an OrchestratorError so callers only have to
 * pattern-match one error type.
 */
function liftFetcherError(err: unknown): OrchestratorError {
  if (err instanceof OrchestratorError) {
    return err
  }
  if (err instanceof FetcherError) {
    return new OrchestratorError(err.code, err.message)
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new OrchestratorError('TIMEOUT', 'fetcher aborted by timeout')
  }
  const message = err instanceof Error ? err.message : String(err)
  return new OrchestratorError('PROVIDER_FAILURE', message)
}

function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new OrchestratorError('INVALID_URL', 'invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OrchestratorError('INVALID_URL', 'only http(s) URLs are supported')
  }
  return url.href
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new OrchestratorError('TIMEOUT', `operation exceeded ${ms}ms`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function validateFetchResult(r: FetchResult): void {
  const htmlBytes = r.meta?.bytes ?? new TextEncoder().encode(r.htmlContent).byteLength
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new OrchestratorError('TOO_LARGE', `HTML payload ${htmlBytes} bytes exceeds limit`)
  }
  if (r.screenshot && r.screenshot.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new OrchestratorError('TOO_LARGE', `screenshot ${r.screenshot.byteLength} bytes exceeds limit`)
  }
}

/** PreviewUrl: run the fetcher only, return metadata + a small text sample. */
export async function previewUrl(
  env: Bindings,
  input: PreviewUrlInput,
): Promise<PreviewUrlOutput> {
  const url = normalizeUrl(input.url)
  const cfg = await getUrlArchiverConfig(env.DB)
  const fetcher = getContentFetcher(input.fetcherProvider, env, cfg)

  const fetched: FetchResult = await withTimeout(
    fetcher.fetch(url, { timeoutMs: DEFAULT_FETCHER_TIMEOUT_MS }),
    DEFAULT_FETCHER_TIMEOUT_MS + 1000,
  ).catch((e) => {
    throw liftFetcherError(e)
  })

  validateFetchResult(fetched)

  return {
    finalUrl: fetched.finalUrl,
    title: fetched.title,
    metaDescription: fetched.metaDescription,
    textSample: (fetched.textContent ?? '').slice(0, PREVIEW_TEXT_SAMPLE_CHARS),
    hasScreenshot: !!fetched.screenshot,
    fetcherUsed: fetched.meta.providerName ?? fetcher.name,
    bytes: fetched.meta.bytes ?? 0,
    fetchedAt: fetched.meta.fetchedAt ?? new Date().toISOString(),
  }
}

/**
 * ArchiveByUrl: fetch → optional AI summary → R2 + D1 persistence.
 *
 * Idempotent on `pageUrl`: returns `{ status: 'duplicate', pageId }` if a
 * non-deleted page already exists for the same URL.
 */
export async function archiveByUrl(
  env: Bindings,
  input: ArchiveByUrlInput,
): Promise<ArchiveByUrlOutput> {
  // 1. validate url
  let url: string
  try {
    url = normalizeUrl(input.url)
  }
  catch (e) {
    if (e instanceof OrchestratorError) {
      return { status: 'error', code: e.code, message: e.message }
    }
    throw e
  }

  // 2. duplicate check
  const existing = await queryPageByUrl(env.DB, url)
  if (existing && existing.length > 0) {
    return { status: 'duplicate', pageId: existing[0].id }
  }

  // 3. resolve config + per-call options
  const cfg = await getUrlArchiverConfig(env.DB)
  const opts = input.options ?? {}
  const generateSummary = opts.generateSummary ?? cfg.generateSummaryByDefault
  const captureScreenshot = opts.captureScreenshot ?? cfg.captureScreenshotByDefault

  // 4. fetch
  const fetcher = getContentFetcher(opts.fetcherProvider, env, cfg)
  let fetched: FetchResult
  try {
    fetched = await withTimeout(
      fetcher.fetch(url, {
        timeoutMs: DEFAULT_FETCHER_TIMEOUT_MS,
        captureScreenshot,
      }),
      DEFAULT_FETCHER_TIMEOUT_MS + 1000,
    )
    validateFetchResult(fetched)
  }
  catch (e) {
    const lifted = liftFetcherError(e)
    return { status: 'error', code: lifted.code, message: lifted.message }
  }

  // 5. derive title + description
  const title = (input.titleOverride?.trim()
    || fetched.title?.trim()
    || new URL(url).hostname)

  let pageDesc = input.pageDescOverride?.trim() ?? ''
  if (!pageDesc && generateSummary) {
    try {
      const enhancer = getAIEnhancer(cfg.aiSummary, env)
      pageDesc = await enhancer.summarize({
        title,
        url,
        textContent: fetched.textContent,
        language: 'language' in cfg.aiSummary ? cfg.aiSummary.language : undefined,
        maxChars:
          'maxChars' in cfg.aiSummary && cfg.aiSummary.maxChars
            ? cfg.aiSummary.maxChars
            : SUMMARY_DEFAULT_MAX_CHARS,
      })
    }
    catch (e) {
      // AI failure is non-fatal: fall through to the meta description.
      const reason = e instanceof AIEnhancerError ? e.code : 'unknown'
      console.warn(`[archive_by_url] ai summary failed (${reason}); falling back to meta description`)
      pageDesc = ''
    }
  }
  if (!pageDesc) {
    pageDesc = fetched.metaDescription ?? ''
  }

  // 6. persist HTML + optional screenshot to R2
  let contentUrl: string | undefined
  let screenshotId: string | undefined
  try {
    contentUrl = await saveFileToBucket(env.BUCKET, fetched.htmlContent)
    if (fetched.screenshot && captureScreenshot) {
      const id = crypto.randomUUID()
      await env.BUCKET.put(id, fetched.screenshot)
      screenshotId = id
    }
  }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { status: 'error', code: 'STORAGE', message: `failed to write to R2: ${message}` }
  }
  if (!contentUrl) {
    return { status: 'error', code: 'STORAGE', message: 'failed to write HTML to R2' }
  }

  // 7. insert page row + bind tags
  let pageId: number
  try {
    pageId = await insertPage(env.DB, {
      title,
      pageDesc,
      pageUrl: url,
      contentUrl,
      folderId: input.folderId,
      screenshotId,
      isShowcased: !!input.isShowcased,
    })
  }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { status: 'error', code: 'DB', message: `failed to insert page: ${message}` }
  }
  if (!pageId) {
    return { status: 'error', code: 'DB', message: 'insertPage returned no id' }
  }

  const bindTags = input.bindTags ?? []
  if (bindTags.length > 0) {
    try {
      await updateBindPageByTagName(
        env.DB,
        bindTags.map((tagName: string) => ({ tagName, pageIds: [pageId] })),
        [],
      )
    }
    catch (e) {
      // Tag binding failure shouldn't unwind the page insert; just log.
      const message = e instanceof Error ? e.message : String(e)
      console.warn(`[archive_by_url] failed to bind tags for page ${pageId}: ${message}`)
    }
  }

  return {
    status: 'created',
    pageId,
    title,
    pageDesc,
    fetcherUsed: fetched.meta?.providerName ?? fetcher.name,
  }
}

/** Map an OrchestratorError code to the HTTP status the API layer should return. */
export function orchestratorCodeToHttpStatus(code: OrchestratorError['code']): number {
  switch (code) {
    case 'INVALID_URL':
      return 400
    case 'UPSTREAM_4XX':
      return 404
    case 'TIMEOUT':
      return 504
    case 'TOO_LARGE':
      return 413
    case 'NOT_IMPLEMENTED':
      return 501
    case 'UPSTREAM_5XX':
    case 'PROVIDER_FAILURE':
      return 502
    case 'STORAGE':
    case 'DB':
      return 500
    default: {
      const _exhaustive: never = code
      void _exhaustive
      return 500
    }
  }
}
