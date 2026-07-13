import { describe, expect, it } from 'vitest'

import { buildReasoningProviderOptions } from './reasoning-options.ts'

describe('buildReasoningProviderOptions', () => {
  it('maps OpenAI effort with reasoning summary', () => {
    expect(buildReasoningProviderOptions('openai', 'high')).toEqual({
      openai: { reasoningEffort: 'high', reasoningSummary: 'auto' },
    })
  })

  it('maps Anthropic effort to a thinking budget', () => {
    expect(buildReasoningProviderOptions('anthropic', 'medium')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } },
    })
  })

  it('maps Google effort to thinkingLevel and includeThoughts', () => {
    expect(buildReasoningProviderOptions('google', 'xhigh')).toEqual({
      google: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' },
      },
    })
  })

  it('returns empty options for unknown providers', () => {
    expect(buildReasoningProviderOptions('unknown', 'low')).toEqual({})
  })
})
