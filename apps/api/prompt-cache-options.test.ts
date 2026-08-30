import { describe, expect, it } from 'vitest'

import {
  buildCachedSystemPrompt,
  buildOpaquePromptCacheKey,
  buildPromptCacheProviderOptions,
  mergeProviderOptions,
} from './prompt-cache-options.ts'

describe('buildOpaquePromptCacheKey', () => {
  it('prefers deck id, then chat thread', () => {
    expect(
      buildOpaquePromptCacheKey({
        deckId: 'deck-1',
        chatThreadId: 'thread-1',
      }),
    ).toBe('deck-1')
    expect(
      buildOpaquePromptCacheKey({
        deckId: null,
        chatThreadId: 'thread-1',
      }),
    ).toBe('thread-1')
  })

  it('returns no key rather than a per-job key that would fragment routing affinity', () => {
    expect(buildOpaquePromptCacheKey({})).toBeUndefined()
    expect(buildOpaquePromptCacheKey({ deckId: null, chatThreadId: null })).toBeUndefined()
  })
})

describe('buildPromptCacheProviderOptions', () => {
  it('adds OpenAI promptCacheKey when an opaque key is present', () => {
    expect(
      buildPromptCacheProviderOptions({
        provider: 'openai',
        promptCacheKey: 'deck-1',
      }),
    ).toEqual({
      openai: { promptCacheKey: 'deck-1' },
    })
  })

  it('skips OpenAI options without a key and never opts Google/Anthropic in here', () => {
    expect(
      buildPromptCacheProviderOptions({
        provider: 'openai',
        promptCacheKey: null,
      }),
    ).toBeUndefined()
    expect(
      buildPromptCacheProviderOptions({
        provider: 'anthropic',
        promptCacheKey: 'deck-1',
      }),
    ).toBeUndefined()
    expect(
      buildPromptCacheProviderOptions({
        provider: 'google',
        promptCacheKey: 'deck-1',
      }),
    ).toBeUndefined()
  })
})

describe('buildCachedSystemPrompt', () => {
  it('marks Anthropic system prompts with ephemeral cacheControl', () => {
    expect(buildCachedSystemPrompt('anthropic', 'stable prefix')).toEqual({
      role: 'system',
      content: 'stable prefix',
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    })
  })

  it('leaves non-Anthropic system prompts as plain strings', () => {
    expect(buildCachedSystemPrompt('openai', 'stable prefix')).toBe('stable prefix')
    expect(buildCachedSystemPrompt('google', 'stable prefix')).toBe('stable prefix')
  })
})

describe('mergeProviderOptions', () => {
  it('merges provider bags without dropping either side', () => {
    expect(
      mergeProviderOptions(
        { openai: { reasoningEffort: 'high' } },
        { openai: { promptCacheKey: 'deck-1' } },
        { anthropic: { effort: 'high' } },
      ),
    ).toEqual({
      openai: { reasoningEffort: 'high', promptCacheKey: 'deck-1' },
      anthropic: { effort: 'high' },
    })
  })
})
