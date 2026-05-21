# URL-Only Archive — Implementation Tasks

Tasks are grouped by phase. Each task lists the files it touches and the acceptance check to confirm it is done. Phases 1–3 land the **contract and end-to-end skeleton**; Phase 4 is where actual fetcher providers get implemented (deferred per user's request).

---

## Phase 1 — Shared types & contracts

### T1.1 Define shared types
- [ ] Create `packages/shared/types/url-archiver.ts` with:
  - `FetcherProviderName`, `FetchOptions`, `FetchResult`, `ContentFetcher`
  - `SummaryInput`, `AIEnhancer`
  - `ArchiveByUrlInput`, `ArchiveByUrlOutput`
  - `UrlArchiverConfig` (discriminated union by `provider`)
- [ ] Re-export from `packages/shared/types/index.ts`.

**Acceptance**: `pnpm -F @web-archive/shared exec tsc --noEmit` passes.

### T1.2 Provider name constants
- [ ] Create `packages/server/src/constants/url-archiver.ts` with the list of provider names and the default config.

---

## Phase 2 — Server services (interface + stubs)

### T2.1 Content-fetcher interface and stubs
- [ ] `packages/server/src/services/content-fetcher/types.ts` — re-export from shared.
- [ ] `packages/server/src/services/content-fetcher/noop.ts` — returns a deterministic synthetic `FetchResult`.
- [ ] `packages/server/src/services/content-fetcher/raw-fetch.ts` — class skeleton, `fetch()` throws `not implemented`.
- [ ] `packages/server/src/services/content-fetcher/jina-reader.ts` — class skeleton, `fetch()` throws `not implemented`.
- [ ] `packages/server/src/services/content-fetcher/cf-browser-rendering.ts` — class skeleton, `fetch()` throws `not implemented`.
- [ ] `packages/server/src/services/content-fetcher/firecrawl.ts` — class skeleton, `fetch()` throws `not implemented`.
- [ ] `packages/server/src/services/content-fetcher/index.ts` — `getContentFetcher(name, env, cfg)` factory.

**Acceptance**: `getContentFetcher('noop', env, cfg).fetch('https://x')` returns a populated `FetchResult` without network access.

### T2.2 AI-enhancer interface and stubs
- [ ] `packages/server/src/services/ai-enhancer/types.ts`
- [ ] `packages/server/src/services/ai-enhancer/noop.ts` — returns the empty string from `summarize`, no `suggestTags`.
- [ ] `packages/server/src/services/ai-enhancer/cloudflare-ai.ts` — uses `c.env.AI`, throws `not implemented` for now.
- [ ] `packages/server/src/services/ai-enhancer/openai-compatible.ts` — class skeleton.
- [ ] `packages/server/src/services/ai-enhancer/index.ts` — `getAIEnhancer(cfg, env)` factory.

### T2.3 Archive orchestrator
- [ ] `packages/server/src/services/archive-orchestrator.ts` implementing the algorithm in design §6.
- [ ] Includes the duplicate-check step (`queryPageByUrl`) and reuses `saveFileToBucket`, `insertPage`, `updateBindPageByTagName`.

**Acceptance**: Orchestrator with `NoopFetcher` and `NoopEnhancer` creates a real page row and returns `{ status: 'created', pageId, … }`.

### T2.4 Config persistence
- [ ] In `packages/server/src/model/store.ts` add `getUrlArchiverConfig(db)` and `setUrlArchiverConfig(db, cfg)`, mirroring `getAITagConfig` / `setAITagConfig`.
- [ ] Default value: `{ provider: 'raw-fetch', generateSummaryByDefault: false, generateTagsByDefault: false, captureScreenshotByDefault: false }`.

---

## Phase 3 — HTTP API surface

### T3.1 `POST /api/pages/preview_url`
- [ ] Add route in `packages/server/src/api/pages.ts`.
- [ ] Validates `{ url: string, fetcherProvider?: string }` with zod.
- [ ] Calls fetcher only; returns `{ finalUrl, title, metaDescription, textSample, hasScreenshot, fetcherUsed, bytes, fetchedAt }`.
- [ ] Maps fetcher errors to `502` / `504` / `400` appropriately.

### T3.2 `POST /api/pages/archive_by_url`
- [ ] Add route in `packages/server/src/api/pages.ts`.
- [ ] Validates `ArchiveByUrlInput` with zod (`discriminatedUnion` for `options` not required, but URL must be a valid `z.string().url()`).
- [ ] Delegates to `archiveByUrl` orchestrator.
- [ ] Returns `ArchiveByUrlOutput` wrapped in the existing `result.success(...)` envelope.

### T3.3 `GET/POST /api/config/url_archiver`
- [ ] Add routes in `packages/server/src/api/config.ts` mirroring `ai_tag` shape.
- [ ] `GET` redacts `apiKey` to `'***'` when present.
- [ ] `POST` preserves the existing `apiKey` if the value `'***'` is sent.

**Acceptance**: From a logged-in client:
```
curl -XPOST .../api/pages/archive_by_url \
  -H 'Authorization: Bearer …' \
  -d '{"url":"https://example.com/", "folderId": 0, "options": {"fetcherProvider":"noop"}}'
```
returns `{ code: 0, data: { status: 'created', pageId: <n>, … } }` and the page is visible in `/api/pages/query`.

---

## Phase 4 — Web client UI (skeleton)

### T4.1 API client wrappers
- [ ] In `packages/web/src/data/...` add `archiveByUrl(input)` and `previewUrl(input)` calling the new endpoints.

### T4.2 "Archive a URL" dialog
- [ ] Add a dialog component triggered from the home page header.
- [ ] Fields: `url`, `folderId` select, optional `title`, `pageDesc`, `bindTags`, `isShowcased`.
- [ ] Two actions: **Preview** (calls `/preview_url` and shows result inline) and **Save** (calls `/archive_by_url`).
- [ ] On `duplicate` response, link to the existing page.

### T4.3 Settings — URL Archiver section
- [ ] Add a section to the settings page that reads/writes `UrlArchiverConfig`.
- [ ] Provider dropdown disables fields not relevant to the chosen provider.
- [ ] Mark `apiKey` field as "leave blank to keep current" hint.

---

## Phase 5 — Real providers (deferred — separate PRs)

> Each item below is one isolated PR. The contract is already locked by Phase 1–3, so the API and storage stay untouched.

- [ ] **P5.1** Implement `RawFetchFetcher` (`fetch` + a worker-compatible Readability port; SSRF guard).
- [ ] **P5.2** Implement `JinaReaderFetcher` (prepends `https://r.jina.ai/` to the URL; supports optional API key header).
- [ ] **P5.3** Implement `CfBrowserRenderingFetcher` (uses the `c.env.BROWSER` binding via the REST scrape/content endpoint; produces full HTML + screenshot).
- [ ] **P5.4** Implement `FirecrawlFetcher` (REST call to `/v2/scrape`).
- [ ] **P5.5** Implement `CloudflareAIEnhancer.summarize` using a small text-gen model (e.g. `@cf/meta/llama-3.1-8b-instruct`) with a length-capped prompt.
- [ ] **P5.6** Implement `OpenAICompatibleEnhancer.summarize` — POST to `${apiUrl}/chat/completions` like the existing AI-tag flow does.

---

## Risk / Watch-list

- **Worker CPU time**: providers that do post-processing (e.g. parsing huge HTML in JS) may exceed the free-tier 30s CPU limit. Plan to add a `maxBytes` guard in each provider implementation.
- **Wrangler local vs CF prod parity**: `c.env.BROWSER` only exists when the `[browser]` binding is configured in `wrangler.toml`. Phase 5.3 will need a `wrangler.toml` change behind a feature flag.
- **Showcase exposure**: A URL-archived page can also be `isShowcased=1`. Verify the existing showcase view tolerates pages where the HTML came from a fetcher rather than `single-file` (it should — same `contentUrl`).

---

## Definition of Done (v1, end of Phase 3)

- All new types and endpoints exist and compile.
- `NoopFetcher` lets a developer archive a page end-to-end without any external dependency.
- Config CRUD round-trips through D1.
- The existing extension flow is unchanged: zero modifications to `upload_new_page`, `manifest.*.json`, or any popup code.
- Spec docs (this folder) reflect what shipped.
