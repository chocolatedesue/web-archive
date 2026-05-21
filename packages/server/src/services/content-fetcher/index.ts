import type { FetcherProviderName, UrlArchiverConfig } from '@web-archive/shared/types'
import type { Bindings } from '~/constants/binding'
import { CfBrowserRenderingFetcher } from './cf-browser-rendering'
import { FirecrawlFetcher } from './firecrawl'
import { JinaReaderFetcher } from './jina-reader'
import { NoopFetcher } from './noop'
import { RawFetchFetcher } from './raw-fetch'
import type { ContentFetcher } from './types'

/**
 * Resolve the request-time fetcher.
 *
 * - When `requested === 'auto'` (or omitted) the configured provider wins.
 * - Otherwise the explicit name overrides the configured provider for this call.
 * - The `'auto'` value itself is never instantiated.
 */
export function getContentFetcher(
  requested: FetcherProviderName | undefined,
  env: Bindings,
  cfg: UrlArchiverConfig,
): ContentFetcher {
  const resolved: Exclude<FetcherProviderName, 'auto'>
    = (requested && requested !== 'auto') ? requested : cfg.provider

  switch (resolved) {
    case 'noop':
      return new NoopFetcher()
    case 'raw-fetch':
      return new RawFetchFetcher()
    case 'jina-reader':
      return new JinaReaderFetcher(cfg)
    case 'cf-browser-rendering':
      return new CfBrowserRenderingFetcher(env)
    case 'firecrawl':
      return new FirecrawlFetcher(cfg)
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (resolved as any)
      throw new Error(`Unknown fetcher provider: ${resolved as string}`)
    }
  }
}

export type { ContentFetcher } from './types'
export { FetcherError } from './types'
