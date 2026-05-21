import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * STUB. Phase 5 will implement this to:
 *   1. Reject SSRF targets (private IP ranges).
 *   2. `fetch()` the URL with a UA + redirect cap.
 *   3. Parse the HTML and extract title / meta description / readable text
 *      (e.g. via a worker-compatible Readability port such as linkedom +
 *      @mozilla/readability).
 *   4. Return the original HTML as `htmlContent`.
 *
 * Until then it throws so callers fail loudly.
 */
export class RawFetchFetcher implements ContentFetcher {
  readonly name = 'raw-fetch' as const

  // eslint-disable-next-line unused-imports/no-unused-vars
  async fetch(_url: string, _options?: FetchOptions): Promise<FetchResult> {
    throw new FetcherError('NOT_IMPLEMENTED', 'RawFetchFetcher is not implemented yet', this.name)
  }
}
