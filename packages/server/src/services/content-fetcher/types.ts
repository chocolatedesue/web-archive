// Re-export the contract from the shared package so server-side modules can
// `import from '~/services/content-fetcher/types'` without reaching into shared.
export type {
  ContentFetcher,
  FetcherProviderName,
  FetchOptions,
  FetchResult,
  FetchResultMeta,
} from '@web-archive/shared/types'

/**
 * Thrown by every concrete fetcher to communicate a clear failure mode back to
 * the orchestrator. The orchestrator maps these to HTTP status codes.
 */
export class FetcherError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_URL'
      | 'UPSTREAM_4XX'
      | 'UPSTREAM_5XX'
      | 'TIMEOUT'
      | 'TOO_LARGE'
      | 'NOT_IMPLEMENTED'
      | 'PROVIDER_FAILURE',
    message: string,
    public readonly providerName?: string,
  ) {
    super(message)
    this.name = 'FetcherError'
  }
}
