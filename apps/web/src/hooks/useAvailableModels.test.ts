import { describe, expect, it } from 'vitest'

import {
  formatModelLabel,
  formatModelName,
  formatProviderLabel,
  formatUnavailableBadge,
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
        id: 'anthropic:claude-haiku-4-5',
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        available: true,
      }),
      model({
        id: 'google:gemini-3.5-flash',
        provider: 'google',
        modelId: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        available: true,
      }),
    ]

    expect(pickAvailableFallbackModel(models)).toBe('anthropic:claude-haiku-4-5')
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
      id: 'openai:gpt-4.1-mini',
      provider: 'openai',
      modelId: 'gpt-4.1-mini',
      name: 'GPT-4.1 Mini',
      available: true,
    }),
    model({
      id: 'anthropic:claude-haiku-4-5',
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      available: true,
    }),
    model({
      id: 'google:gemini-3.5-flash',
      provider: 'google',
      modelId: 'gemini-3.5-flash',
      name: 'Gemini 3.5 Flash',
      available: true,
    }),
  ]

  it('keeps the stored model when it is available', () => {
    expect(resolveSelectedModel(models, 'google:gemini-3.5-flash', 'openai:gpt-4.1-mini')).toBe(
      'google:gemini-3.5-flash',
    )
  })

  it('prefers an available server default over the cheapest fallback', () => {
    expect(resolveSelectedModel(models, null, 'openai:gpt-4.1-mini')).toBe('openai:gpt-4.1-mini')
  })

  it('falls back when the default model has no API key', () => {
    expect(resolveSelectedModel(models, null, 'openai:gpt-4o-mini')).toBe(
      'anthropic:claude-haiku-4-5',
    )
  })

  it('falls back when the stored model is unavailable', () => {
    expect(resolveSelectedModel(models, 'openai:gpt-4o-mini', 'openai:gpt-4o-mini')).toBe(
      'anthropic:claude-haiku-4-5',
    )
  })

  it('uses the available default when the stored model is unavailable', () => {
    expect(resolveSelectedModel(models, 'openai:gpt-4o-mini', 'openai:gpt-4.1-mini')).toBe(
      'openai:gpt-4.1-mini',
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

describe('model selector display helpers', () => {
  it('formats names, provider labels, and unavailable badges', () => {
    const available = model({
      id: 'openai:gpt-4o-mini',
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      available: true,
    })

    expect(formatModelName(available)).toBe('GPT-4o Mini')
    expect(formatModelName(model({ ...available, name: undefined }))).toBe('gpt-4o-mini')
    expect(formatProviderLabel('anthropic')).toBe('Anthropic')
    expect(formatUnavailableBadge(available)).toBeNull()
    expect(
      formatUnavailableBadge(
        model({
          ...available,
          available: false,
          unavailableReason: 'missing_api_key',
        }),
      ),
    ).toBe('No API key')
    expect(
      formatUnavailableBadge(
        model({
          ...available,
          available: false,
          unavailableReason: 'not_found',
        }),
      ),
    ).toBe('Unavailable')
  })
})
