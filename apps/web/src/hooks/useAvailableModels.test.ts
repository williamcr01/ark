import { describe, expect, it } from 'vitest'

import {
  formatModelLabel,
  pickAvailableFallbackModel,
  resolveSelectedModel,
  type AvailableModel,
} from './useAvailableModels'

const model = (
  partial: Pick<AvailableModel, 'id' | 'provider' | 'modelId' | 'available'> &
    Partial<AvailableModel>,
): AvailableModel => ({
  name: partial.name,
  unavailableReason: partial.unavailableReason,
  ...partial,
})

describe('pickAvailableFallbackModel', () => {
  it('prefers mini/flash/haiku models over larger ones', () => {
    const models: AvailableModel[] = [
      model({
        id: 'openai:gpt-4o',
        provider: 'openai',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        available: true,
      }),
      model({
        id: 'anthropic:claude-3-5-haiku-latest',
        provider: 'anthropic',
        modelId: 'claude-3-5-haiku-latest',
        name: 'Claude 3.5 Haiku',
        available: true,
      }),
      model({
        id: 'google:gemini-2.5-pro',
        provider: 'google',
        modelId: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        available: true,
      }),
    ]

    expect(pickAvailableFallbackModel(models)).toBe('anthropic:claude-3-5-haiku-latest')
  })

  it('returns null when no models are available', () => {
    const models: AvailableModel[] = [
      model({
        id: 'openai:gpt-4o-mini',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        available: false,
        unavailableReason: 'missing_api_key',
      }),
    ]

    expect(pickAvailableFallbackModel(models)).toBeNull()
  })
})

describe('resolveSelectedModel', () => {
  const models: AvailableModel[] = [
    model({
      id: 'openai:gpt-4o-mini',
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      available: false,
      unavailableReason: 'missing_api_key',
    }),
    model({
      id: 'anthropic:claude-3-5-haiku-latest',
      provider: 'anthropic',
      modelId: 'claude-3-5-haiku-latest',
      name: 'Claude 3.5 Haiku',
      available: true,
    }),
    model({
      id: 'google:gemini-2.0-flash',
      provider: 'google',
      modelId: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      available: true,
    }),
  ]

  it('keeps the stored model when it is available', () => {
    expect(resolveSelectedModel(models, 'google:gemini-2.0-flash', 'openai:gpt-4o-mini')).toBe(
      'google:gemini-2.0-flash',
    )
  })

  it('falls back when the default model has no API key', () => {
    expect(resolveSelectedModel(models, null, 'openai:gpt-4o-mini')).toBe(
      'anthropic:claude-3-5-haiku-latest',
    )
  })

  it('falls back when the stored model is unavailable', () => {
    expect(resolveSelectedModel(models, 'openai:gpt-4o-mini', 'openai:gpt-4o-mini')).toBe(
      'anthropic:claude-3-5-haiku-latest',
    )
  })
})

describe('formatModelLabel', () => {
  it('marks missing API keys and other unavailable models', () => {
    expect(
      formatModelLabel(
        model({
          id: 'openai:gpt-4o-mini',
          provider: 'openai',
          modelId: 'gpt-4o-mini',
          name: 'GPT-4o Mini',
          available: false,
          unavailableReason: 'missing_api_key',
        }),
      ),
    ).toBe('openai · GPT-4o Mini (no API key)')

    expect(
      formatModelLabel(
        model({
          id: 'openai:gpt-4o',
          provider: 'openai',
          modelId: 'gpt-4o',
          name: 'GPT-4o',
          available: false,
          unavailableReason: 'not_found',
        }),
      ),
    ).toBe('openai · GPT-4o (unavailable)')
  })
})
