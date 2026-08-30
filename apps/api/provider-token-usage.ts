import type { ProviderTokenUsage } from '@ark/deck-core/generation-job.ts'

/** Normalize AI SDK usage (including step-summed cache details) into job metrics. */
export function normalizeProviderTokenUsage(usage: {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  totalTokens?: number | undefined
  inputTokenDetails?: {
    noCacheTokens?: number | undefined
    cacheReadTokens?: number | undefined
    cacheWriteTokens?: number | undefined
  }
}): ProviderTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    noCacheTokens: usage.inputTokenDetails?.noCacheTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
  }
}
