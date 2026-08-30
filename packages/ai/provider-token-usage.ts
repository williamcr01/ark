/** Token accounting reported by a provider for one agent run. */
export type ProviderTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  /** Non-cached input tokens. Step-summed across the multi-step tool loop. */
  noCacheTokens?: number
  /**
   * Input tokens served from the provider prompt cache.
   * Step-summed across the multi-step tool loop (same prefix counted once per
   * step — measures savings, not unique cached tokens).
   */
  cacheReadTokens?: number
  /** Input tokens written into the provider prompt cache. Step-summed. */
  cacheWriteTokens?: number
}
