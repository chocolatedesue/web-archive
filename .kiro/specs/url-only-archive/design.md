# URL-Only Archive — Design

## 1. Architecture Overview

```
                    ┌────────────────────────────────────────┐
  POST /api/pages/  │  Hono Route Handler (api/pages.ts)     │
  archive_by_url    │  - validate input                      │
   ───────────────► │  - check duplicate by pageUrl          │
                    │  - call ArchiveOrchestrator            │
                    └──────────────┬─────────────────────────┘
                                   │
                                   ▼
                    ┌────────────────────────────────────────┐
                    │  ArchiveOrchestrator                   │
                    │  (services/archive-orchestrator.ts)    │
                    │                                        │
                    │  1. resolve config                     │
                    │  2. fetcher.fetch(url) ───────────┐    │
                    │  3. enhancer.summarize(...) ──┐   │    │
                    │  4. saveFileToBucket × 2      │   │    │
                    │  5. insertPage + bindTags     │   │    │
                    └───────────────────────────────┼───┼────┘
                                                    │   │
                          ┌─────────────────────────┘   │
                          ▼                             ▼
              ┌──────────────────────┐    ┌─────────────────────────┐
              │  AIEnhancer          │    │  ContentFetcher         │
              │  (interface)         │    │  (interface)            │
              ├──────────────────────┤    ├─────────────────────────┤
              │ - cloudflare-ai      │    │ - raw-fetch             │
              │ - openai-compatible  │    │ - jina-reader           │
              │ - noop               │    │ - cf-browser-rendering  │
              │                      │    │ - firecrawl             │
              │                      │    │ - noop (echo)           │
              └──────────────────────┘    └─────────────────────────┘

                                   ▼
                    ┌────────────────────────────────────────┐
                    │  Existing storage layer (unchanged)    │
                    │  - utils/file.ts → R2                  │
                    │  - model/page.ts → D1                  │
                    │  - model/tag.ts  → D1                  │
                    └────────────────────────────────────────┘
```

The two abstractions (`ContentFetcher`, `AIEnhancer`) are the swappable seams. Everything else stays as-is.

## 2. Module Layout

```
packages/server/src/
├── api/
│   ├── pages.ts                          # + archive_by_url, + preview_url
│   └── config.ts                         # + url_archiver get/post
├── services/                             # NEW
│   ├── content-fetcher/
│   │   ├── index.ts                      # factory + re-exports
│   │   ├── types.ts                      # ContentFetcher, FetchResult
│   │   ├── noop.ts                       # echo provider for tests / spec
│   │   ├── raw-fetch.ts                  # STUB
│   │   ├── jina-reader.ts                # STUB
│   │   ├── cf-browser-rendering.ts       # STUB
│   │   └── firecrawl.ts                  # STUB
│   ├── ai-enhancer/
│   │   ├── index.ts                      # factory + re-exports
│   │   ├── types.ts
│   │   ├── noop.ts                       # passthrough enhancer
│   │   ├── cloudflare-ai.ts              # STUB (uses c.env.AI)
│   │   └── openai-compatible.ts          # STUB
│   └── archive-orchestrator.ts           # composes fetcher + enhancer + storage
├── model/
│   └── store.ts                          # + getUrlArchiverConfig, setUrlArchiverConfig
└── constants/
    └── url-archiver.ts                   # provider name enums, defaults

packages/shared/types/
└── url-archiver.ts                       # types shared with web client
```

> All `STUB` files implement the interface and return `Promise.reject(new Error('not implemented'))` until a concrete provider is built. The orchestrator and API contract do not depend on which provider is chosen.

## 3. Type Contracts

These types live in `packages/shared/types/url-archiver.ts` so both server and web client agree on them.

```ts
// ─── Content fetcher ────────────────────────────────────────────────

export type FetcherProviderName =
  | 'auto'
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

export interface FetchResult {
  finalUrl: string
  title: string
  /** Raw <meta name="description"> content if any */
  metaDescription: string
  /** A self-contained HTML snapshot that the user will see when opening the page */
  htmlContent: string
  /** Plain text or markdown extracted from the page; used as input to AI summary */
  textContent: string
  /** webp/png bytes; orchestrator stores these in R2 */
  screenshot?: ArrayBuffer
  meta: {
    fetchedAt: string             // ISO date
    contentType: string
    statusCode: number
    bytes: number
    providerName: string
  }
}

export interface ContentFetcher {
  readonly name: FetcherProviderName
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>
}

// ─── AI enhancer ────────────────────────────────────────────────────

export interface SummaryInput {
  title: string
  url: string
  textContent: string
  language?: 'en' | 'zh'
  maxChars?: number
}

export interface AIEnhancer {
  readonly name: string
  /** Returns a short description suitable for `pageDesc` (≈ 200 chars) */
  summarize(input: SummaryInput): Promise<string>
  /** Optional; if undefined, the orchestrator falls back to existing /api/tags/generate_tag */
  suggestTags?(input: SummaryInput): Promise<string[]>
}

// ─── Orchestrator I/O ───────────────────────────────────────────────

export interface ArchiveByUrlInput {
  url: string
  folderId: number
  titleOverride?: string
  pageDescOverride?: string
  bindTags?: string[]
  isShowcased?: boolean
  options?: {
    fetcherProvider?: FetcherProviderName
    generateSummary?: boolean
    generateTags?: boolean
    captureScreenshot?: boolean
  }
}

export type ArchiveByUrlOutput =
  | { status: 'created'; pageId: number; title: string; pageDesc: string; fetcherUsed: string }
  | { status: 'duplicate'; pageId: number }
  | { status: 'error'; code: string; message: string }
```

## 4. Configuration

Stored in the existing key/value store table the same way `ai_tag` is stored.

```ts
// packages/shared/types/url-archiver.ts (continued)

export type UrlArchiverConfig =
  | {
      provider: 'raw-fetch'
      generateSummaryByDefault: boolean
      generateTagsByDefault: boolean
      captureScreenshotByDefault: boolean
    }
  | {
      provider: 'jina-reader'
      apiKey?: string                          // optional; jina works without
      generateSummaryByDefault: boolean
      generateTagsByDefault: boolean
      captureScreenshotByDefault: boolean
    }
  | {
      provider: 'cf-browser-rendering'
      // uses c.env.BROWSER binding; no extra creds
      generateSummaryByDefault: boolean
      generateTagsByDefault: boolean
      captureScreenshotByDefault: boolean
    }
  | {
      provider: 'firecrawl'
      apiKey: string
      apiUrl?: string                          // for self-hosted
      generateSummaryByDefault: boolean
      generateTagsByDefault: boolean
      captureScreenshotByDefault: boolean
    }
```

Validated by a `z.discriminatedUnion('provider', [...])`, mirroring `ai_tag` validation.

## 5. API Contracts

All endpoints sit under `/api/pages/` and `/api/config/`, behind the existing token middleware.

### 5.1 `POST /api/pages/preview_url`

Runs the fetcher only — no AI, no storage. Returns the metadata and a content sample so the UI can show a preview card.

**Request**
```json
{
  "url": "https://example.com/article",
  "fetcherProvider": "auto"
}
```

**Response (success)**
```json
{
  "code": 0,
  "data": {
    "finalUrl": "https://example.com/article",
    "title": "Example Article",
    "metaDescription": "An example article",
    "textSample": "First 2000 chars of extracted text...",
    "hasScreenshot": false,
    "fetcherUsed": "raw-fetch",
    "bytes": 184321,
    "fetchedAt": "2026-05-21T10:00:00.000Z"
  }
}
```

**Errors**: `400` invalid url, `502` fetcher failure, `504` timeout.

### 5.2 `POST /api/pages/archive_by_url`

Runs fetcher → optional AI → storage, all server-side.

**Request**
```json
{
  "url": "https://example.com/article",
  "folderId": 0,
  "title": "Optional override",
  "pageDesc": "Optional override",
  "bindTags": ["reading"],
  "isShowcased": false,
  "options": {
    "fetcherProvider": "auto",
    "generateSummary": true,
    "generateTags": false,
    "captureScreenshot": true
  }
}
```

**Response — created**
```json
{
  "code": 0,
  "data": {
    "status": "created",
    "pageId": 123,
    "title": "Example Article",
    "pageDesc": "AI-generated 200-char summary…",
    "fetcherUsed": "jina-reader"
  }
}
```

**Response — duplicate**
```json
{
  "code": 0,
  "data": { "status": "duplicate", "pageId": 87 }
}
```

**Response — error**
```json
{
  "code": 502,
  "message": "fetcher 'jina-reader' failed: HTTP 500"
}
```

### 5.3 `GET /api/config/url_archiver`

Returns the current `UrlArchiverConfig`. Sensitive fields (`apiKey`) SHALL be redacted to `'***'` in the response; the client only sees whether a key is set.

### 5.4 `POST /api/config/url_archiver`

Body is a `UrlArchiverConfig`. Validated by `discriminatedUnion`. If `apiKey` is `'***'` (the redacted sentinel) the existing key is preserved; any other value overwrites it.

## 6. Orchestrator Algorithm

```ts
async function archiveByUrl(env, db, bucket, ai, input: ArchiveByUrlInput): Promise<ArchiveByUrlOutput> {
  // 1. validate URL
  const url = safeNormalizeUrl(input.url)

  // 2. duplicate check
  const existing = await queryPageByUrl(db, url)
  if (existing && !existing.isDeleted) {
    return { status: 'duplicate', pageId: existing.id }
  }

  // 3. resolve config + per-call options
  const cfg = await getUrlArchiverConfig(db)
  const opts = mergeOptions(cfg, input.options)

  // 4. fetch
  const fetcher = getContentFetcher(opts.fetcherProvider, env, cfg)
  const fetched = await withTimeout(opts.timeoutMs, fetcher.fetch(url, opts))

  // 5. derive title + description
  let title = input.titleOverride ?? fetched.title ?? new URL(url).hostname
  let pageDesc = input.pageDescOverride
  if (!pageDesc && opts.generateSummary) {
    const enhancer = getAIEnhancer(cfg, env)
    pageDesc = await enhancer.summarize({
      title, url, textContent: fetched.textContent, maxChars: 200,
    }).catch(() => fetched.metaDescription)
  }
  pageDesc ??= fetched.metaDescription

  // 6. optional auto-tags
  let bindTags = input.bindTags ?? []
  if (opts.generateTags && bindTags.length === 0) {
    bindTags = await maybeGenerateTags(env, ai, { title, pageDesc })
  }

  // 7. persist
  const [contentUrl, screenshotId] = await Promise.all([
    saveFileToBucket(bucket, fetched.htmlContent),
    fetched.screenshot ? saveFileToBucket(bucket, fetched.screenshot) : Promise.resolve(null),
  ])
  if (!contentUrl) return { status: 'error', code: 'STORAGE', message: 'r2 put failed' }

  const pageId = await insertPage(db, {
    title, pageDesc, pageUrl: url, contentUrl, folderId: input.folderId,
    screenshotId, isShowcased: !!input.isShowcased,
  })
  if (!pageId) return { status: 'error', code: 'DB', message: 'insertPage failed' }

  if (bindTags.length) {
    await updateBindPageByTagName(db, bindTags.map(t => ({ tagName: t, pageIds: [pageId] })), [])
  }

  return { status: 'created', pageId, title, pageDesc, fetcherUsed: fetcher.name }
}
```

## 7. Fetcher Factory

```ts
// services/content-fetcher/index.ts

import type { Bindings } from '~/constants/binding'
import type { UrlArchiverConfig } from '@web-archive/shared/types'
import type { ContentFetcher, FetcherProviderName } from './types'

import { NoopFetcher } from './noop'
// stubs — actual implementation deferred
import { RawFetchFetcher } from './raw-fetch'
import { JinaReaderFetcher } from './jina-reader'
import { CfBrowserRenderingFetcher } from './cf-browser-rendering'
import { FirecrawlFetcher } from './firecrawl'

export function getContentFetcher(
  name: FetcherProviderName,
  env: Bindings,
  cfg: UrlArchiverConfig,
): ContentFetcher {
  const resolved = name === 'auto' ? cfg.provider : name
  switch (resolved) {
    case 'raw-fetch':            return new RawFetchFetcher()
    case 'jina-reader':          return new JinaReaderFetcher(cfg)
    case 'cf-browser-rendering': return new CfBrowserRenderingFetcher(env)
    case 'firecrawl':            return new FirecrawlFetcher(cfg)
    default:                     return new NoopFetcher()
  }
}
```

> **Important:** at the time this spec is implemented, every concrete provider class except `NoopFetcher` may simply throw `new Error('not implemented')` from its `fetch` method. The point of v1 is to land the contract and the orchestrator; choosing and implementing a provider is a separate, isolated PR.

## 8. AI Enhancer Factory

Same structure. Default config uses `provider: 'noop'` until the admin opts in. Cloudflare AI binding is reused via the existing `c.env.AI` so no new infrastructure is required.

## 9. Database Changes

**None required for v1.**

- The `pages` table already has `pageDesc`, `contentUrl`, `screenshotId`, etc.
- The `url_archiver` config is stored in the existing key/value store (same row pattern as `ai_tag`).
- Optional future addition: an `archiveSource` column (`'extension' | 'url'`) to filter URL-archived pages in the UI; deferred.

## 10. Web Client Changes

- Add `archiveByUrl(input)` and `previewUrl(input)` to the existing API client module.
- Add a "Archive a URL" dialog accessible from the home page, with: URL input, folder select, optional title/desc overrides, "Preview" and "Save" buttons.
- Add a settings page section "URL Archiver" mirroring the existing AI-tag settings UI.

## 11. Security Considerations

- **SSRF**: The fetcher MUST refuse to fetch private IP ranges (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `::1`, `fc00::/7`). The `RawFetchFetcher` enforces this; remote SaaS providers (Jina, Firecrawl) handle it on their side.
- **Auth secrets**: `apiKey` fields are stored verbatim in D1 (same as the existing `ai_tag` config) and redacted in `GET` responses.
- **Size limits**: HTML > 10 MiB SHALL be rejected to prevent R2 abuse. Screenshots > 2 MiB SHALL be rejected.
- **Rate limiting**: Out of scope for v1; rely on the auth requirement and CF Workers' platform-level limits.

## 12. Testing Strategy

- **Unit-level**: `NoopFetcher` makes the orchestrator deterministically testable end-to-end without network. Tests assert that title fallback, duplicate detection, AI fallback and tag binding all behave correctly with synthetic inputs.
- **Integration**: When a real provider is implemented, add one happy-path test against a known-stable URL behind a recorded fixture.
- **Contract**: A small interface-conformance test ensures every provider class returns a `FetchResult` with all required fields populated.

## 13. Migration / Rollout

1. Ship endpoints + orchestrator + stubs. They work end-to-end with `NoopFetcher` (which returns a tiny canned page) so the UI can be developed.
2. Implement one real provider (recommended first: `RawFetchFetcher` — pure `fetch` + Readability-like extraction, no external dependency). Roll it out as the default.
3. Add additional providers as separate PRs without touching the API surface.

## 14. Open Questions (deferred to implementation)

- Which Readability-equivalent library runs inside Workers? (`@mozilla/readability` requires a DOM; `linkedom` may work.) — to be decided when `RawFetchFetcher` is implemented.
- Should `preview_url` cache results per URL for a few minutes? — likely yes, but deferred.
- Async / queued mode with a `tasks` table — deferred to v2.
