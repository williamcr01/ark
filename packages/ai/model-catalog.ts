import type { ProviderId } from './provider-id.ts'
import type { ReasoningEffort } from './reasoning-effort.ts'

/**
 * How Ark maps a UI effort level onto providerOptions for a given model.
 * Catalog entries pick one strategy so the picker and agent stay aligned.
 */
export type ReasoningTransport =
  'openai-effort' | 'anthropic-adaptive' | 'anthropic-budget' | 'google-thinking-level' | 'none'

export type ModelCatalogEntry = {
  provider: ProviderId
  modelId: string
  name: string
  reasoningEfforts: readonly ReasoningEffort[]
  defaultReasoningEffort?: ReasoningEffort
  reasoningTransport: ReasoningTransport
  /**
   * Whether chat attachments / deck assets may be sent to this model.
   * Defaults to true when omitted.
   */
  supportsAttachments?: boolean
}

export const catalogSupportsAttachments = (entry: ModelCatalogEntry | undefined): boolean =>
  entry?.supportsAttachments !== false

const OPENAI_GPT56_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[]

const OPENAI_STANDARD_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[]

const ANTHROPIC_ADAPTIVE_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[]

const ANTHROPIC_HAIKU_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[]

const GEMINI_FLASH_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[]

const GEMINI_36_FLASH_EFFORTS = ['medium', 'high'] as const satisfies readonly ReasoningEffort[]

const GEMINI_FLASH_LITE_EFFORTS = [
  'minimal',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[]

const GEMINI_PRO_EFFORTS = ['low', 'medium', 'high'] as const satisfies readonly ReasoningEffort[]

/**
 * Curated Ark model catalog (issue #211).
 * Order within each provider is the UI display order.
 */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    provider: 'openai',
    modelId: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    reasoningEfforts: OPENAI_GPT56_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'openai-effort',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    reasoningEfforts: OPENAI_GPT56_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'openai-effort',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    reasoningEfforts: OPENAI_GPT56_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'openai-effort',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5.5',
    name: 'GPT-5.5',
    reasoningEfforts: OPENAI_STANDARD_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'openai-effort',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5.4',
    name: 'GPT-5.4',
    reasoningEfforts: OPENAI_STANDARD_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'openai-effort',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    reasoningEfforts: OPENAI_STANDARD_EFFORTS,
    defaultReasoningEffort: 'none',
    reasoningTransport: 'openai-effort',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-fable-5',
    name: 'Claude Fable 5',
    reasoningEfforts: ANTHROPIC_ADAPTIVE_EFFORTS,
    defaultReasoningEffort: 'high',
    reasoningTransport: 'anthropic-adaptive',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    reasoningEfforts: ANTHROPIC_ADAPTIVE_EFFORTS,
    defaultReasoningEffort: 'high',
    reasoningTransport: 'anthropic-adaptive',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    reasoningEfforts: ANTHROPIC_ADAPTIVE_EFFORTS,
    defaultReasoningEffort: 'high',
    reasoningTransport: 'anthropic-adaptive',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    reasoningEfforts: ANTHROPIC_HAIKU_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'anthropic-budget',
  },
  {
    provider: 'google',
    modelId: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    reasoningEfforts: GEMINI_36_FLASH_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'google-thinking-level',
  },
  {
    provider: 'google',
    modelId: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    reasoningEfforts: GEMINI_FLASH_EFFORTS,
    defaultReasoningEffort: 'medium',
    reasoningTransport: 'google-thinking-level',
  },
  {
    provider: 'google',
    modelId: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    reasoningEfforts: GEMINI_FLASH_LITE_EFFORTS,
    defaultReasoningEffort: 'minimal',
    reasoningTransport: 'google-thinking-level',
  },
  {
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    reasoningEfforts: GEMINI_PRO_EFFORTS,
    defaultReasoningEffort: 'high',
    reasoningTransport: 'google-thinking-level',
  },
] as const

export const DEFAULT_MODEL_REF = 'openai:gpt-5.6-luna'

export const toModelRef = (provider: ProviderId, modelId: string) => `${provider}:${modelId}`

let discoveredCatalogEntries: readonly ModelCatalogEntry[] = []

/** Overlay live-discovered models (OpenRouter) onto the static first-party catalog. */
export const setDiscoveredCatalogEntries = (entries: readonly ModelCatalogEntry[]) => {
  discoveredCatalogEntries = entries
}

export const findCatalogEntry = (
  provider: ProviderId,
  modelId: string,
): ModelCatalogEntry | undefined =>
  MODEL_CATALOG.find((entry) => entry.provider === provider && entry.modelId === modelId) ??
  discoveredCatalogEntries.find((entry) => entry.provider === provider && entry.modelId === modelId)

export const findCatalogEntryByRef = (modelRef: string): ModelCatalogEntry | undefined => {
  const separatorIndex = modelRef.indexOf(':')
  if (separatorIndex <= 0) {
    return undefined
  }

  const provider = modelRef.slice(0, separatorIndex) as ProviderId
  const modelId = modelRef.slice(separatorIndex + 1)
  return findCatalogEntry(provider, modelId)
}

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  value === 'none' ||
  value === 'minimal' ||
  value === 'low' ||
  value === 'medium' ||
  value === 'high' ||
  value === 'xhigh' ||
  value === 'max'

export const resolveCatalogReasoningEffort = (
  entry: ModelCatalogEntry | undefined,
  requested?: ReasoningEffort | null,
): { ok: true; effort?: ReasoningEffort } | { ok: false; error: string } => {
  if (!entry) {
    if (requested) {
      return { ok: false, error: 'Unknown model cannot accept a reasoning effort.' }
    }
    return { ok: true }
  }

  if (entry.reasoningEfforts.length === 0) {
    if (requested) {
      return {
        ok: false,
        error: `${entry.name} does not support reasoning effort.`,
      }
    }
    return { ok: true }
  }

  if (requested) {
    if (!entry.reasoningEfforts.includes(requested)) {
      return {
        ok: false,
        error: `${entry.name} does not support reasoning effort "${requested}".`,
      }
    }
    return { ok: true, effort: requested }
  }

  return {
    ok: true,
    effort: entry.defaultReasoningEffort ?? entry.reasoningEfforts[0],
  }
}
