import type { AIEnhancerConfig } from '@web-archive/shared/types'
import type { Bindings } from '~/constants/binding'
import type { AIEnhancer, SummaryInput } from './types'
import { AIEnhancerError } from './types'

/**
 * STUB. Phase 5 will implement this using `c.env.AI.run(model, { messages })`,
 * mirroring the existing `/api/tags/generate_tag` flow but with a
 * "summarize this page" system prompt and JSON-mode response parsing.
 */
export class CloudflareAIEnhancer implements AIEnhancer {
  readonly name = 'cloudflare' as const

  constructor(
    private readonly env: Bindings,
    private readonly cfg: Extract<AIEnhancerConfig, { type: 'cloudflare' }>,
  ) {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  async summarize(_input: SummaryInput): Promise<string> {
    void this.env
    void this.cfg
    throw new AIEnhancerError(
      'NOT_IMPLEMENTED',
      'CloudflareAIEnhancer.summarize is not implemented yet',
      this.name,
    )
  }
}
