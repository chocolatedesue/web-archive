# URL-Only Archive — Requirements

## 1. Background

Today, archiving a page in `web-archive` requires the browser extension because:

- The HTML body (`pageFile`) is captured **inside the browser tab** by the `single-file` library.
- `title`, `pageDesc` and the screenshot all come from the live tab DOM / browser screenshot API.

This means users cannot archive a page in any of the following contexts:

- From a mobile browser without an extension
- From a server-side workflow (e.g. RSS, automation, IFTTT, public submission link)
- From the web UI itself ("paste a URL, save it")
- In bulk from a list of URLs

## 2. Goal

Add a new flow where a user (or another system) submits **only a URL**, and the server:

1. Fetches the page on its own
2. Extracts a usable HTML snapshot, title and description
3. Optionally generates an AI summary and/or tags
4. Stores the page using the existing `Page` schema (R2 + D1)

The end result must be **indistinguishable** from a page archived via the extension — same model, same listing, same view, same showcase.

## 3. In Scope

- A new authenticated server endpoint that accepts a URL and creates a `Page` record.
- A pluggable **content-fetcher abstraction** so the actual "how to fetch" can be swapped (Jina Reader, Cloudflare Browser Rendering, raw `fetch`, Firecrawl, …) without touching the API or the storage layer.
- A pluggable **AI-enhancer abstraction** that generates a summary (and optionally tags) from the fetched content, reusing the existing AI binding patterns.
- Configuration endpoints so the admin can pick the provider and supply credentials, mirroring the existing `/api/config/ai_tag` pattern.
- A web-UI affordance to use the new flow ("Archive a URL" dialog).

## 4. Out of Scope (for this spec)

- The concrete implementation of any fetcher provider — all provider modules in this spec are stub interfaces. Choosing and implementing the fetcher is a separate task.
- Async / queued archiving with progress polling. v1 is **synchronous**, returning the created page or an error.
- Bulk URL upload. The endpoint takes one URL per call; the client can loop.
- Browser-extension changes (the existing flow keeps working unchanged).

## 5. Functional Requirements

### FR-1 — Archive by URL
The system SHALL provide an authenticated endpoint that, given a URL, fetches the page, stores the HTML in R2 and inserts a `Page` row in D1.

**Inputs**: `url` (required), `folderId` (required), optional `title`, `pageDesc`, `bindTags`, `isShowcased`, and per-call `options` (see FR-4).

**Outputs**: the created `Page` (or its `id`) on success, or an error with reason on failure.

### FR-2 — Title, description and screenshot
- `title` SHALL be taken from the user override if provided, otherwise from the fetcher result, otherwise from the URL hostname as a fallback.
- `pageDesc` SHALL be taken from the user override if provided, otherwise from AI summary if AI is enabled, otherwise from the fetched `<meta name="description">`.
- A screenshot is OPTIONAL. If the fetcher returns one, it SHALL be stored just like the extension's screenshot.

### FR-3 — Preview before save
The system SHOULD provide a separate "preview" endpoint that runs only the fetcher (no AI, no storage) and returns metadata, so the web UI can show "this is what we found" before the user commits.

### FR-4 — Per-call overrides
The caller MAY pass options to override the configured defaults for a single call:
- `fetcherProvider`: name of the provider to use (`auto` = use server default)
- `generateSummary`: boolean
- `generateTags`: boolean
- `captureScreenshot`: boolean

### FR-5 — Provider configuration
The system SHALL expose `GET /api/config/url_archiver` and `POST /api/config/url_archiver` to read/write:
- The default fetcher provider name
- The credentials/options for that provider (token, endpoint, etc.)
- Whether to generate summary by default
- Whether to generate tags by default
- Which AI model to use for summary

The shape mirrors the existing `ai_tag` config, including discriminated unions per provider type.

### FR-6 — Authentication
The new endpoints SHALL be protected by the same `tokenMiddleware` as the rest of `/api/*`.

### FR-7 — Idempotency / duplicates
If a page with the same `pageUrl` already exists and is not deleted, the endpoint SHALL return a structured response `{ status: 'duplicate', pageId }` rather than creating a second row. The client decides whether to update or ignore.

### FR-8 — Failure modes
The endpoint SHALL return distinct, machine-readable error codes for:
- `400` invalid URL / missing fields
- `404` upstream URL returned 4xx
- `502` fetcher provider failure (with provider name in message)
- `504` fetcher timeout
- `500` storage / DB failure

## 6. Non-Functional Requirements

### NFR-1 — Pluggability
Adding a new fetcher provider SHALL only require:
1. Creating one file in `packages/server/src/services/content-fetcher/<provider>.ts` that implements the `ContentFetcher` interface.
2. Registering it in the fetcher factory (one line).

No changes to the API layer, DB schema, or storage layer should be required.

### NFR-2 — Reuse existing storage
The new flow SHALL reuse `insertPage`, `saveFileToBucket`, `updateBindPageByTagName` etc. exactly as the extension flow does. No parallel storage path.

### NFR-3 — Worker compatibility
All code SHALL run inside Cloudflare Workers (the production runtime) and `node-cf-worker` (the Docker runtime). No Node-only APIs; only `fetch`, `crypto`, `TextEncoder/Decoder`, and bindings.

### NFR-4 — Timeouts
The default per-fetcher timeout SHALL be 25s on the free CF Worker plan, configurable via fetcher options. The orchestrator SHALL enforce a global wall-clock budget and abort cleanly.

### NFR-5 — Observability
Each archive attempt SHALL log: `provider`, `url`, `status`, `latencyMs`, `bytes`, optional `errorCode`. No PII beyond the URL itself is logged.

## 7. User Stories

- **U1** As a mobile user without the extension, I open the web UI, paste a URL, click "Archive", and the page appears in my list with title and description filled in.
- **U2** As an admin, I open Settings, pick "Jina Reader" as my fetcher, save a token, and from then on URL-archived pages use it automatically.
- **U3** As an automation script, I `POST` a URL with my admin token and get back the `pageId` of the created entry.
- **U4** As a user, before saving I can preview what title and description the server extracted, and edit them inline.

## 8. Acceptance Criteria

- A page archived via URL appears in `/api/pages/query` with the same fields as one archived via the extension.
- Switching fetcher providers in `/api/config/url_archiver` does not require redeploy.
- Submitting an already-archived URL returns the existing `pageId` instead of creating a duplicate.
- All new endpoints reject requests without a valid bearer token.
- Disabling AI in config skips both summary and tag generation, and `pageDesc` falls back to the fetched meta description.
