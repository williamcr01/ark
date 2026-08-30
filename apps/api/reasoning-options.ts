import type { ReasoningEffort } from '@ark/contracts'

import { findCatalogEntryByRef, type ReasoningTransport } from './model-catalog.ts'
import type { ProviderOptions } from './provider-options.ts'

const ANTHROPIC_THINKING_BUDGET: Record<
  Extract<ReasoningEffort, 'low' | 'medium' | 'high' | 'xhigh'>,
  number
> = {
  low: 2048,
  medium: 8192,
  high: 16_384,
  xhigh: 32_768,
}

const resolveTransport = (modelRef: string): ReasoningTransport => {
  const entry = findCatalogEntryByRef(modelRef)
  return entry?.reasoningTransport ?? 'none'
}

/** Build AI SDK providerOptions for reasoning effort (ai@6 has no portable `reasoning` param). */
export const buildReasoningProviderOptions = (
  effort: ReasoningEffort,
  modelRef: string,
): ProviderOptions => {
  const transport = resolveTransport(modelRef)

  switch (transport) {
    case 'openai-effort':
      return {
        openai: {
          reasoningEffort: effort,
          ...(effort === 'none' ? {} : { reasoningSummary: 'auto' }),
        },
      }
    case 'anthropic-adaptive':
      return {
        anthropic: {
          thinking: {
            type: 'adaptive',
            display: 'summarized',
          },
          effort,
        },
      }
    case 'anthropic-budget': {
      if (effort !== 'low' && effort !== 'medium' && effort !== 'high' && effort !== 'xhigh') {
        return {}
      }

      return {
        anthropic: {
          thinking: {
            type: 'enabled',
            budgetTokens: ANTHROPIC_THINKING_BUDGET[effort],
          },
        },
      }
    }
    case 'google-thinking-level': {
      if (effort !== 'minimal' && effort !== 'low' && effort !== 'medium' && effort !== 'high') {
        return {}
      }

      return {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: effort,
          },
        },
      }
    }
    case 'none':
    default:
      return {}
  }
}
