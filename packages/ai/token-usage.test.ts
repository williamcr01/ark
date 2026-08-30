import { describe, expect, it } from 'vitest'

import { normalizeProviderTokenUsage } from './token-usage.ts'

describe('normalizeProviderTokenUsage', () => {
  it('plumbs cache read/write/no-cache details from AI SDK usage', () => {
    expect(
      normalizeProviderTokenUsage({
        inputTokens: 1200,
        outputTokens: 80,
        totalTokens: 1280,
        inputTokenDetails: {
          noCacheTokens: 200,
          cacheReadTokens: 900,
          cacheWriteTokens: 100,
        },
      }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 80,
      totalTokens: 1280,
      noCacheTokens: 200,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    })
  })

  it('keeps missing cache details undefined (implicit-caching baseline)', () => {
    expect(
      normalizeProviderTokenUsage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    })
  })

  it('preserves step-summed totals from multi-step aggregation', () => {
    // totalUsage is already step-summed by the AI SDK; we must not re-average.
    const stepSummed = normalizeProviderTokenUsage({
      inputTokens: 3000,
      outputTokens: 120,
      totalTokens: 3120,
      inputTokenDetails: {
        noCacheTokens: 400,
        cacheReadTokens: 2400,
        cacheWriteTokens: 200,
      },
    })
    expect(stepSummed.cacheReadTokens).toBe(2400)
    expect(stepSummed.inputTokens).toBe(3000)
  })
})
