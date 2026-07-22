import { describe, expect, it } from 'vitest'

import { buildReasoningProviderOptions } from './reasoning-options.ts'

describe('buildReasoningProviderOptions', () => {
  it('maps OpenAI effort with reasoning summary except for none', () => {
    expect(buildReasoningProviderOptions('openai', 'high', 'openai:gpt-5.6-sol')).toEqual({
      openai: { reasoningEffort: 'high', reasoningSummary: 'auto' },
    })
    expect(buildReasoningProviderOptions('openai', 'none', 'openai:gpt-5.5')).toEqual({
      openai: { reasoningEffort: 'none' },
    })
  })

  it('maps Claude adaptive models to adaptive thinking + effort', () => {
    expect(
      buildReasoningProviderOptions('anthropic', 'xhigh', 'anthropic:claude-opus-4-8'),
    ).toEqual({
      anthropic: {
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'xhigh',
      },
    })
  })

  it('maps Claude Haiku to budget-based thinking', () => {
    expect(
      buildReasoningProviderOptions('anthropic', 'medium', 'anthropic:claude-haiku-4-5'),
    ).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } },
    })
  })

  it('maps Gemini 3.x models to thinkingLevel', () => {
    expect(buildReasoningProviderOptions('google', 'minimal', 'google:gemini-3.6-flash')).toEqual({
      google: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: 'minimal' },
      },
    })
  })

  it('maps Gemini 2.5 Flash to thinkingBudget', () => {
    expect(buildReasoningProviderOptions('google', 'high', 'google:gemini-2.5-flash')).toEqual({
      google: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: 16_384 },
      },
    })
  })

  it('returns empty options for Codex Spark and unknown providers', () => {
    expect(buildReasoningProviderOptions('openai', 'high', 'openai:gpt-5.3-codex-spark')).toEqual(
      {},
    )
    expect(buildReasoningProviderOptions('unknown', 'low')).toEqual({})
  })
})
