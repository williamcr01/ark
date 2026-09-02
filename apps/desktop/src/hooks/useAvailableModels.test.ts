import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchModelCatalogWithRetry,
  formatModelLabel,
  formatModelName,
  formatProviderLabel,
  isTransientModelLoadError,
  pickAvailableFallbackModel,
  resolveSelectedModel,
  useAvailableModels,
  type AvailableModel,
} from './useAvailableModels'
import { getDesktopSettings, resetDesktopSettingsForTests } from '@/lib/ui/desktop-settings'

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
    expect(result.current.selectedModel).toBe('')
    expect(getDesktopSettings().selectedModel).toBeNull()
  })

  it('clears the stored selection when the catalog is empty', async () => {
    resetDesktopSettingsForTests({ selectedModel: 'openai:gpt-5.6-luna' })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/health')) {
        return jsonResponse({
          ...healthResponse,
          apiKey: { configured: false },
          providers: {
            openai: { configured: false },
            anthropic: { configured: false },
            google: { configured: false },
            openrouter: { configured: false },
          },
        })
      }

      return jsonResponse({ defaultModel: null, models: [], warnings: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAvailableModels())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.models).toEqual([])
    expect(result.current.defaultModel).toBeNull()
    expect(result.current.selectedModel).toBe('')
    expect(result.current.canGenerate).toBe(false)
    expect(result.current.apiKeyStatus).toBe('missing')
    expect(getDesktopSettings().selectedModel).toBeNull()
  })

  it('clears a stale stored id after the catalog loads', async () => {
    resetDesktopSettingsForTests({ selectedModel: 'openai:gpt-gone' })
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

    expect(result.current.selectedModel).toBe('openai:gpt-5.6-luna')
    expect(getDesktopSettings().selectedModel).toBe('openai:gpt-5.6-luna')
  })

  it('surfaces catalog warnings without adding missing_api_key rows', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/health')) {
        return jsonResponse({
          ...healthResponse,
          providers: {
            ...healthResponse.providers,
            openrouter: { configured: true },
          },
        })
      }

      return jsonResponse({
        defaultModel: 'openrouter:anthropic/claude-3.5-sonnet',
        models: [
          {
            id: 'openrouter:anthropic/claude-3.5-sonnet',
            provider: 'openrouter',
            modelId: 'anthropic/claude-3.5-sonnet',
            name: 'Claude 3.5 Sonnet',
            available: true,
            reasoningEfforts: ['low', 'medium', 'high'],
            defaultReasoningEffort: 'medium',
            supportsAttachments: true,
          },
        ],
        warnings: ['Could not list OpenAI models.'],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAvailableModels())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.warnings).toEqual(['Could not list OpenAI models.'])
    expect(result.current.models).toHaveLength(1)
    expect(result.current.models[0]?.provider).toBe('openrouter')
    expect(
      result.current.models.some((entry) => entry.unavailableReason === 'missing_api_key'),
    ).toBe(false)
    expect(result.current.selectedModel).toBe('openrouter:anthropic/claude-3.5-sonnet')
    expect(result.current.canGenerate).toBe(true)
  })

  it('clears a previously selected model after a credential change empties the catalog', async () => {
    resetDesktopSettingsForTests({ selectedModel: 'openai:gpt-5.6-luna' })
    let catalogEmpty = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/health')) {
        return jsonResponse(
          catalogEmpty
            ? {
                ...healthResponse,
                apiKey: { configured: false },
                providers: {
                  openai: { configured: false },
                  anthropic: { configured: false },
                  google: { configured: false },
                  openrouter: { configured: false },
                },
              }
            : healthResponse,
        )
      }

      return jsonResponse(
        catalogEmpty ? { defaultModel: null, models: [], warnings: [] } : modelsResponse,
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAvailableModels())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.selectedModel).toBe('openai:gpt-5.6-luna')

    catalogEmpty = true
    await result.current.loadModels()

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('')
    })
    expect(result.current.models).toEqual([])
    expect(result.current.canGenerate).toBe(false)
    expect(getDesktopSettings().selectedModel).toBeNull()
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
    expect(pickAvailableFallbackModel([])).toBeNull()
  })
})

describe('resolveSelectedModel', () => {
  const models: AvailableModel[] = [
    model({
      id: 'openai:gpt-5.6-sol',
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      available: true,
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
    model({
      id: 'openrouter:anthropic/claude-3.5-sonnet',
      provider: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
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

  it('falls back when the default model is missing from the catalog', () => {
    expect(resolveSelectedModel(models, null, 'openai:gpt-missing')).toBe(
      'anthropic:claude-haiku-4-5',
    )
  })

  it('clears a stale stored id that is no longer in the catalog', () => {
    expect(resolveSelectedModel(models, 'openai:gpt-gone', 'openai:gpt-5.6-luna')).toBe(
      'openai:gpt-5.6-luna',
    )
  })

  it('skips an unavailable stored model still present in the payload', () => {
    const withGhost: AvailableModel[] = [
      model({
        id: 'openai:gpt-ghost',
        provider: 'openai',
        modelId: 'gpt-ghost',
        available: false,
        unavailableReason: 'missing_api_key',
      }),
      ...models,
    ]

    expect(resolveSelectedModel(withGhost, 'openai:gpt-ghost', 'openai:gpt-5.6-luna')).toBe(
      'openai:gpt-5.6-luna',
    )
  })

  it('clears the selection when the catalog is empty', () => {
    expect(resolveSelectedModel([], 'openai:gpt-5.6-luna', null)).toBe('')
    expect(resolveSelectedModel([], 'openai:gpt-5.6-luna', 'openai:gpt-5.6-luna')).toBe('')
  })
})

describe('formatModelLabel', () => {
  it('uses the display name when present, otherwise the catalog id', () => {
    expect(
      formatModelLabel(
        model({
          id: 'openai:gpt-5.6-luna',
          provider: 'openai',
          modelId: 'gpt-5.6-luna',
          name: 'GPT-5.6 Luna',
          available: true,
        }),
      ),
    ).toBe('openai · GPT-5.6 Luna')

    expect(
      formatModelLabel(
        model({
          id: 'openrouter:meta-llama/llama-3.1-8b-instruct',
          provider: 'openrouter',
          modelId: 'meta-llama/llama-3.1-8b-instruct',
          available: true,
        }),
      ),
    ).toBe('openrouter:meta-llama/llama-3.1-8b-instruct')
  })
})

describe('model selector display helpers', () => {
  it('formats names and provider labels, including OpenRouter', () => {
    const available = model({
      id: 'openai:gpt-5.6-luna',
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      available: true,
    })

    expect(formatModelName(available)).toBe('GPT-5.6 Luna')
    expect(formatModelName(model({ ...available, name: undefined }))).toBe('gpt-5.6-luna')
    expect(formatModelName(model({ ...available, name: '  ' }))).toBe('gpt-5.6-luna')
    expect(formatProviderLabel('anthropic')).toBe('Anthropic')
    expect(formatProviderLabel('openrouter')).toBe('OpenRouter')
  })
})
