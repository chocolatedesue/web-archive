import type { UrlArchiverConfig } from '@web-archive/shared/types'
import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * STUB. Phase 5 will implement this to POST `/v2/scrape` to the configured
 * Firecrawl endpoint (cloud or self-hosted) with the user's API key, then
 * map the markdown + html result back into a `FetchResult`.
 */
export class FirecrawlFetcher implements ContentFetcher {
  readonly name = 'firecrawl' as const

  constructor(private readonly cfg: UrlArchiverConfig) {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  async fetch(_url: string, _options?: FetchOptions): Promise<FetchResult> {
    void this.cfg
    throw new FetcherError('NOT_IMPLEMENTED', 'FirecrawlFetcher is not implemented yet', this.name)
  }
}
