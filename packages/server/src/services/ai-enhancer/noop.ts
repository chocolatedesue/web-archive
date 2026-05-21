import type { AIEnhancer, SummaryInput } from './types'

/**
 * Default enhancer used when AI is disabled. `summarize` returns the empty
 * string so the orchestrator falls through to the page's meta description.
 */
export class NoopEnhancer implements AIEnhancer {
  readonly name = 'noop' as const

  // eslint-disable-next-line unused-imports/no-unused-vars
  async summarize(_input: SummaryInput): Promise<string> {
    return ''
  }
}
