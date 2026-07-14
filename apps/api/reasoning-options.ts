import type { ReasoningEffort } from '@ark/contracts'

const ANTHROPIC_THINKING_BUDGET: Record<ReasoningEffort, number> = {
  low: 2048,
  medium: 8192,
  high: 16_384,
  xhigh: 32_768,
}

const GOOGLE_THINKING_LEVEL: Record<ReasoningEffort, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type ProviderOptions = Record<string, { [key: string]: JsonValue }>

/** Build AI SDK providerOptions for reasoning effort (ai@6 has no portable `reasoning` param). */
export const buildReasoningProviderOptions = (
  provider: string,
  effort: ReasoningEffort,
): ProviderOptions => {
  switch (provider) {
    case 'openai':
      return {
        openai: {
          reasoningEffort: effort,
          reasoningSummary: 'auto',
        },
      }
    case 'anthropic':
      return {
        anthropic: {
          thinking: {
            type: 'enabled',
            budgetTokens: ANTHROPIC_THINKING_BUDGET[effort],
          },
        },
      }
    case 'google':
      return {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: GOOGLE_THINKING_LEVEL[effort],
          },
        },
      }
    default:
      return {}
  }
}
