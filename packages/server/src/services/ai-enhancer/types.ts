// Re-export the AI enhancer contract from shared so internal modules can import
// from a single local path without reaching across packages.
export type {
  AIEnhancer,
  AIEnhancerConfig,
  AIEnhancerProviderName,
  SummaryInput,
} from '@web-archive/shared/types'

/** Thrown by enhancer implementations to communicate provider failures. */
export class AIEnhancerError extends Error {
  constructor(
    public readonly code: 'NOT_IMPLEMENTED' | 'PROVIDER_FAILURE' | 'INVALID_RESPONSE',
    message: string,
    public readonly providerName?: string,
  ) {
    super(message)
    this.name = 'AIEnhancerError'
  }
}
