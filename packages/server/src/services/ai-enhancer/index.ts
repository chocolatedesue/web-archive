import type { AIEnhancerConfig } from '@web-archive/shared/types'
import type { Bindings } from '~/constants/binding'
import { CloudflareAIEnhancer } from './cloudflare-ai'
import { NoopEnhancer } from './noop'
import { OpenAICompatibleEnhancer } from './openai-compatible'
import type { AIEnhancer } from './types'

/**
 * Resolve the AI enhancer for the current request based on the persisted
 * configuration. Returns `NoopEnhancer` when AI is disabled or the config
 * variant is unknown, so callers can always invoke `summarize` safely.
 */
export function getAIEnhancer(cfg: AIEnhancerConfig, env: Bindings): AIEnhancer {
  switch (cfg.type) {
    case 'noop':
      return new NoopEnhancer()
    case 'cloudflare':
      return new CloudflareAIEnhancer(env, cfg)
    case 'openai':
      return new OpenAICompatibleEnhancer(cfg)
    default: {
      return new NoopEnhancer()
    }
  }
}

export type { AIEnhancer } from './types'
export { AIEnhancerError } from './types'
