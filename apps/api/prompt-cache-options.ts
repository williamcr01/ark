import type { ModelMessage, SystemModelMessage } from 'ai'

import type { ProviderOptions } from './provider-options.ts'

/** Anthropic default TTL. A breakpoint caches tools → system → messages up to that block. */
const ANTHROPIC_EPHEMERAL_CACHE = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
}

/** How many trailing transcript messages get a moving breakpoint (Anthropic max is 4 total). */
const TRAILING_TRANSCRIPT_BREAKPOINTS = 2

/**
 * Opaque routing key for OpenAI prompt-cache affinity.
 * Deck or chat-thread id only — never job id, user content, or secrets.
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
 * Anthropic uses message-level cacheControl; OpenAI uses this routing key;
 * Google is implicit (telemetry only).
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

/** Mark the stable tools+system prefix for Anthropic. Transcript breakpoints are separate. */
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
    providerOptions: ANTHROPIC_EPHEMERAL_CACHE,
  }
}

function withAnthropicCacheControl(message: ModelMessage): ModelMessage {
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: {
        ...message.providerOptions?.anthropic,
        ...ANTHROPIC_EPHEMERAL_CACHE.anthropic,
      },
    },
  }
}

/**
 * Stamp ephemeral cacheControl on the last 1–2 non-system messages.
 * Returns a new array so earlier steps do not keep stale breakpoints.
 */
export function applyAnthropicConversationCacheBreakpoints(
  messages: ModelMessage[],
): ModelMessage[] {
  const trailing = new Set<number>()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'system') continue
    trailing.add(index)
    if (trailing.size >= TRAILING_TRANSCRIPT_BREAKPOINTS) break
  }
  if (trailing.size === 0) return messages
  return messages.map((message, index) =>
    trailing.has(index) ? withAnthropicCacheControl(message) : message,
  )
}
