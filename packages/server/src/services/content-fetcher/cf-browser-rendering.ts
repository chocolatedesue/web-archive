import type { Bindings } from '~/constants/binding'
import type { ContentFetcher, FetchOptions, FetchResult } from './types'
import { FetcherError } from './types'

/**
 * STUB. Phase 5 will implement this to call the Cloudflare Browser Rendering
 * REST endpoints (`/content` and optionally `/screenshot`) using the account
 * binding. This will require a `BROWSER` binding in `wrangler.toml` and is
 * gated behind that.
 */
export class CfBrowserRenderingFetcher implements ContentFetcher {
  readonly name = 'cf-browser-rendering' as const

  constructor(private readonly env: Bindings) {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  async fetch(_url: string, _options?: FetchOptions): Promise<FetchResult> {
    void this.env
    throw new FetcherError(
      'NOT_IMPLEMENTED',
      'CfBrowserRenderingFetcher is not implemented yet',
      this.name,
    )
  }
}
