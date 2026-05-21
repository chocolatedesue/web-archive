import type { AIEnhancerConfig } from '@web-archive/shared/types'
import type { AIEnhancer, SummaryInput } from './types'
import { AIEnhancerError } from './types'

/**
 * STUB. Phase 5 will implement this by POSTing to `${apiUrl}/chat/completions`
 * with the configured model + bearer token, mirroring the OpenAI-compatible
 * branch of the existing AI-tag flow (`packages/shared/utils/ai.ts`).
 */
export class OpenAICompatibleEnhancer implements AIEnhancer {
  readonly name = 'openai' as const

  constructor(private readonly cfg: Extract<AIEnhancerConfig, { type: 'openai' }>) {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  async summarize(_input: SummaryInput): Promise<string> {
    void this.cfg
    throw new AIEnhancerError(
      'NOT_IMPLEMENTED',
      'OpenAICompatibleEnhancer.summarize is not implemented yet',
      this.name,
    )
  }
}
