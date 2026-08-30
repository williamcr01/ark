import type { SystemModelMessage } from 'ai'

import type { ProviderOptions } from './provider-options.ts'

/**
 * Opaque routing key for OpenAI prompt-cache affinity.
 * Never put user/deck content or secrets here — IDs only.
 *
 * Deliberately has no per-job fallback: a key unique to one job fragments
 * routing affinity worse than sending no key at all, since OpenAI falls back to
 * prefix-hash routing when the field is absent.
 */
export function buildOpaquePromptCacheKey(input: {
  deckId?: string | null
  chatThreadId?: string | null
}): string | undefined {
  return input.deckId ?? input.chatThreadId ?? undefined
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

/**
 * Mark the stable system prefix for Anthropic prompt caching.
 *
 * Anthropic's cache prefix runs tools -> system -> messages, so this single
 * breakpoint covers the tool schemas and the system prompt (core instructions,
 * runtime registry, and agent guides) — all byte-stable across steps and jobs.
 *
 * Scope note: the message transcript stays uncached. It is the part that grows
 * with every tool result, so long edit loops still re-pay full input price for
 * it. Conversation-level (moving-breakpoint) caching is deferred by issue #288
 * step 3 and is the follow-up that captures that win.
 *
 * Cost note: a cache write costs ~25% more than uncached input, so a cold
 * single-step job (an `ask_user` or `propose_themes` round that stops at the
 * pause tool) pays the write premium without a matching read. Multi-step edits
 * repay it from the second step onward; the cache telemetry added alongside
 * this measures the real balance.
 */
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
