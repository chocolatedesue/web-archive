import type { UrlArchiverConfig } from '@web-archive/shared/types'
import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * STUB. Phase 5 will implement this to:
 *   1. Prepend `https://r.jina.ai/` to the URL.
 *   2. Send `Authorization: Bearer <apiKey>` if a key is configured.
 *   3. Receive markdown, return it both as `textContent` and wrapped in
 *      a minimal HTML document for `htmlContent`.
 */
export class JinaReaderFetcher implements ContentFetcher {
  readonly name = 'jina-reader' as const

  constructor(private readonly cfg: UrlArchiverConfig) {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  async fetch(_url: string, _options?: FetchOptions): Promise<FetchResult> {
    void this.cfg
    throw new FetcherError('NOT_IMPLEMENTED', 'JinaReaderFetcher is not implemented yet', this.name)
  }
}
