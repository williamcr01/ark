import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchModelCatalogWithRetry,
  formatModelLabel,
  formatModelName,
  formatProviderLabel,
  formatUnavailableBadge,
  isTransientModelLoadError,
  pickAvailableFallbackModel,
  resolveSelectedModel,
  useAvailableModels,
  type AvailableModel,
} from './useAvailableModels'

const healthResponse = {
  ok: true,
  model: 'openai:gpt-5.6-luna',
  apiKey: { configured: true },
  providers: {
    openai: { configured: true },
    anthropic: { configured: false },
    google: { configured: false },
    openrouter: { configured: false },
  },
  preview: {
    sandboxOrigin: 'http://localhost:5174',
    appOrigin: 'http://localhost:5173',
  },
}

const modelsResponse = {
  defaultModel: 'openai:gpt-5.6-luna',
  models: [
    {
      id: 'openai:gpt-5.6-luna',
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      available: true,
      supportsAttachments: true,
    },
  ],
  warnings: [],
}

const unreadableResponse = () =>
  ({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error('Unexpected token < in JSON')
    },
  }) as unknown as Response

const jsonResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as Response

describe('isTransientModelLoadError', () => {
  it('matches startup proxy and network failures', () => {
    expect(isTransientModelLoadError(new Error('The API returned an unreadable response.'))).toBe(
      true,
    )
    expect(isTransientModelLoadError(new Error('Could not reach the Ark API server.'))).toBe(true)
    expect(isTransientModelLoadError(new Error('Failed to fetch'))).toBe(true)
    expect(isTransientModelLoadError(new Error('Incorrect API key provided'))).toBe(false)
  })
})

describe('fetchModelCatalogWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries transient startup failures and loads models', async () => {
    let modelsCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/health')) {
        return jsonResponse(healthResponse)
      }

      modelsCalls += 1
      if (modelsCalls === 1) {
        return unreadableResponse()
      }

      return jsonResponse(modelsResponse)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchModelCatalogWithRetry({ retries: 2, delayMs: 1 })

    expect(result.models).toHaveLength(1)
    expect(modelsCalls).toBe(2)
  })

  it('throws transient errors without marking them as key failures', async () => {
    const fetchMock = vi.fn(async () => unreadableResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchModelCatalogWithRetry({ retries: 1, delayMs: 1 })).rejects.toThrow(
      'The API returned an unreadable response.',
    )
    expect(isTransientModelLoadError(new Error('The API returned an unreadable response.'))).toBe(
      true,
    )
  })
})

describe('useAvailableModels startup loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('loads models on mount when the API is ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/health')) {
        return jsonResponse(healthResponse)
      }

      return jsonResponse(modelsResponse)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAvailableModels())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBe('')
    expect(result.current.apiKeyStatus).toBe('valid')
    expect(result.current.models).toHaveLength(1)
  })

  it('keeps checking status when startup retries are exhausted', async () => {
    const fetchMock = vi.fn(async () => unreadableResponse())
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAvailableModels())

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 10_000 },
    )

    expect(result.current.error).toBe('The API returned an unreadable response.')
    expect(result.current.apiKeyStatus).toBe('checking')
    expect(result.current.models).toEqual([])
  })
})

const model = (
  partial: Pick<AvailableModel, 'id' | 'provider' | 'modelId' | 'available'> &
    Partial<AvailableModel>,
): AvailableModel => ({
  name: partial.name,
  unavailableReason: partial.unavailableReason,
  supportsAttachments: partial.supportsAttachments ?? true,
  ...partial,
})

describe('pickAvailableFallbackModel', () => {
  it('prefers Flash-Lite over other Gemini Flash models', () => {
    const models: AvailableModel[] = [
      model({
        id: 'google:gemini-3.6-flash',
        provider: 'google',
        modelId: 'gemini-3.6-flash',
        available: true,
      }),
      model({
        id: 'google:gemini-3.5-flash-lite',
        provider: 'google',
        modelId: 'gemini-3.5-flash-lite',
        available: true,
      }),
    ]

    expect(pickAvailableFallbackModel(models)).toBe('google:gemini-3.5-flash-lite')
  })

  it('prefers luna/flash/haiku/mini models over larger ones', () => {
    const models: AvailableModel[] = [
      model({
        id: 'openai:gpt-5.6-sol',
        provider: 'openai',
        modelId: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
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
        id: 'openai:gpt-5.6-luna',
        provider: 'openai',
        modelId: 'gpt-5.6-luna',
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
      id: 'openai:gpt-5.6-sol',
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      available: false,
      unavailableReason: 'missing_api_key',
    }),
    model({
      id: 'openai:gpt-5.6-luna',
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
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
    expect(resolveSelectedModel(models, 'google:gemini-3.5-flash', 'openai:gpt-5.6-luna')).toBe(
      'google:gemini-3.5-flash',
    )
  })

  it('prefers an available server default over the cheapest fallback', () => {
    expect(resolveSelectedModel(models, null, 'openai:gpt-5.6-luna')).toBe('openai:gpt-5.6-luna')
  })

  it('falls back when the default model has no API key', () => {
    expect(resolveSelectedModel(models, null, 'openai:gpt-5.6-sol')).toBe(
      'anthropic:claude-haiku-4-5',
    )
  })

  it('falls back when the stored model is unavailable', () => {
    expect(resolveSelectedModel(models, 'openai:gpt-5.6-sol', 'openai:gpt-5.6-sol')).toBe(
      'anthropic:claude-haiku-4-5',
    )
  })

  it('uses the available default when the stored model is unavailable', () => {
    expect(resolveSelectedModel(models, 'openai:gpt-5.6-sol', 'openai:gpt-5.6-luna')).toBe(
      'openai:gpt-5.6-luna',
    )
  })
})

describe('formatModelLabel', () => {
  it('marks missing API keys and other unavailable models', () => {
    expect(
      formatModelLabel(
        model({
          id: 'openai:gpt-5.6-luna',
          provider: 'openai',
          modelId: 'gpt-5.6-luna',
          name: 'GPT-5.6 Luna',
          available: false,
          unavailableReason: 'missing_api_key',
        }),
      ),
    ).toBe('openai · GPT-5.6 Luna (no API key)')

    expect(
      formatModelLabel(
        model({
          id: 'openai:gpt-5.6-sol',
          provider: 'openai',
          modelId: 'gpt-5.6-sol',
          name: 'GPT-5.6 Sol',
          available: false,
          unavailableReason: 'not_found',
        }),
      ),
    ).toBe('openai · GPT-5.6 Sol (unavailable)')
  })
})

describe('model selector display helpers', () => {
  it('formats names, provider labels, and unavailable badges', () => {
    const available = model({
      id: 'openai:gpt-5.6-luna',
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      available: true,
    })

    expect(formatModelName(available)).toBe('GPT-5.6 Luna')
    expect(formatModelName(model({ ...available, name: undefined }))).toBe('gpt-5.6-luna')
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
