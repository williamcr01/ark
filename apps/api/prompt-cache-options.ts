import type { SystemModelMessage } from 'ai'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type ProviderOptions = Record<string, { [key: string]: JsonValue }>

/**
 * Opaque routing key for OpenAI prompt-cache affinity.
 * Never put user/deck content or secrets here — IDs only.
 */
export function buildOpaquePromptCacheKey(input: {
  deckId?: string | null
  chatThreadId?: string | null
  jobId?: string | null
}): string | undefined {
  return input.deckId ?? input.chatThreadId ?? input.jobId ?? undefined
}

/** Merge AI SDK providerOptions bags (later entries win per provider key). */
export function mergeProviderOptions(
  ...parts: Array<ProviderOptions | undefined>
): ProviderOptions | undefined {
  const merged: ProviderOptions = {}
  for (const part of parts) {
    if (!part) continue
    for (const [provider, options] of Object.entries(part)) {
      merged[provider] = { ...merged[provider], ...options }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Provider-native prompt-cache options.
 * - Anthropic: cacheControl is applied on the system message (see
 *   `buildCachedSystemPrompt`); tools sit before system in the cache prefix.
 * - OpenAI: `promptCacheKey` is a routing-affinity hint only.
 * - Google: implicit caching — telemetry only, no explicit options.
 */
export function buildPromptCacheProviderOptions(input: {
  provider: string
  promptCacheKey?: string | null
}): ProviderOptions | undefined {
  if (input.provider === 'openai' && input.promptCacheKey) {
    return {
      openai: {
        promptCacheKey: input.promptCacheKey,
      },
    }
  }
  return undefined
}

/** Mark the stable system prefix for Anthropic prompt caching. */
export function buildCachedSystemPrompt(
  provider: string,
  system: string,
): string | SystemModelMessage {
  if (provider !== 'anthropic') {
    return system
  }
  return {
    role: 'system',
    content: system,
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
  }
}
