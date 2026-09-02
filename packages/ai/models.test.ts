import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  catalogSupportsAttachments,
  DEFAULT_MODEL_REF,
  findCatalogEntryByRef,
  MODEL_CATALOG,
  resolveCatalogReasoningEffort,
  setDiscoveredCatalogEntries,
} from './model-catalog.ts'
import {
  assertModelAvailable,
  catalogModelAccessible,
  clearModelCatalogCache,
  fetchAllAvailableModels,
  getDefaultModel,
  getModelCatalog,
  MODEL_CATALOG_TTL_MS,
  parseModelRef,
  pickCatalogDefaultModel,
} from './models.ts'
import type { OpenRouterModelPayload } from './openrouter-models.ts'

const ORIGINAL_ENV = { ...process.env }

const openaiList = (ids: string[]) =>
  Response.json({
    data: ids.map((id) => ({ id })),
  })

const openRouterModel = (
  overrides: Partial<OpenRouterModelPayload> & Pick<OpenRouterModelPayload, 'id'>,
): OpenRouterModelPayload => ({
  name: overrides.id,
  architecture: {
    input_modalities: ['text'],
    output_modalities: ['text'],
  },
  supported_parameters: ['tools', 'temperature'],
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
  clearModelCatalogCache()
  setDiscoveredCatalogEntries([])

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, ORIGINAL_ENV)
})

describe('curated model catalog', () => {
  it('contains the curated models in provider order', () => {
    expect(MODEL_CATALOG.map((entry) => `${entry.provider}:${entry.modelId}`)).toEqual([
      'openai:gpt-5.6-sol',
      'openai:gpt-5.6-terra',
      'openai:gpt-5.6-luna',
      'openai:gpt-5.5',
      'openai:gpt-5.4',
      'openai:gpt-5.4-mini',
      'anthropic:claude-fable-5',
      'anthropic:claude-opus-4-8',
      'anthropic:claude-sonnet-5',
      'anthropic:claude-haiku-4-5',
      'google:gemini-3.6-flash',
      'google:gemini-3.5-flash',
      'google:gemini-3.5-flash-lite',
      'google:gemini-3.1-pro-preview',
    ])
  })

  it('advertises per-model reasoning efforts', () => {
    expect(findCatalogEntryByRef('openai:gpt-5.6-sol')?.reasoningEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(findCatalogEntryByRef('openai:gpt-5.4-mini')?.reasoningEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(findCatalogEntryByRef('openai:gpt-5.4-mini')?.defaultReasoningEffort).toBe('none')
    expect(findCatalogEntryByRef('anthropic:claude-fable-5')?.reasoningEfforts).toContain('max')
    expect(findCatalogEntryByRef('google:gemini-3.6-flash')?.reasoningEfforts).toEqual([
      'medium',
      'high',
    ])
    expect(findCatalogEntryByRef('google:gemini-3.5-flash-lite')).toMatchObject({
      reasoningEfforts: ['minimal', 'medium', 'high'],
      defaultReasoningEffort: 'minimal',
    })
    expect(findCatalogEntryByRef('google:gemini-3.1-pro-preview')?.reasoningEfforts).toEqual([
      'low',
      'medium',
      'high',
    ])
  })

  it('resolves defaults and rejects unsupported efforts', () => {
    const sol = findCatalogEntryByRef('openai:gpt-5.6-sol')
    expect(resolveCatalogReasoningEffort(sol, null)).toEqual({ ok: true, effort: 'medium' })
    expect(resolveCatalogReasoningEffort(sol, 'max')).toEqual({ ok: true, effort: 'max' })
    expect(resolveCatalogReasoningEffort(sol, 'minimal').ok).toBe(false)

    const mini = findCatalogEntryByRef('openai:gpt-5.4-mini')
    expect(resolveCatalogReasoningEffort(mini, null)).toEqual({ ok: true, effort: 'none' })
    expect(resolveCatalogReasoningEffort(mini, 'xhigh')).toEqual({ ok: true, effort: 'xhigh' })
    expect(resolveCatalogReasoningEffort(mini, 'max').ok).toBe(false)
  })

  it('defaults attachment support to true', () => {
    expect(catalogSupportsAttachments(findCatalogEntryByRef('openai:gpt-5.4-mini'))).toBe(true)
    expect(catalogSupportsAttachments(undefined)).toBe(true)
    expect(catalogSupportsAttachments({ supportsAttachments: false } as never)).toBe(false)
  })
})

describe('parseModelRef', () => {
  it('parses openrouter refs including slash ids', () => {
    expect(parseModelRef('openrouter:anthropic/claude-3.5-sonnet')).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
    })
  })
})

describe('catalogModelAccessible', () => {
  it('matches exact ids and versioned aliases', () => {
    expect(catalogModelAccessible('claude-sonnet-5', new Set(['claude-sonnet-5-20250514']))).toBe(
      true,
    )
    expect(catalogModelAccessible('gpt-5.4-mini', new Set(['gpt-5.4-mini']))).toBe(true)
    expect(catalogModelAccessible('gpt-5.4-mini', new Set(['gpt-4o']))).toBe(false)
    expect(catalogModelAccessible('gpt-5.4', new Set(['gpt-5.4-mini']))).toBe(false)
    expect(catalogModelAccessible('gpt-5.4-mini', new Set(['gpt-5.4']))).toBe(false)
  })
})

describe('fetchAllAvailableModels', () => {
  it('returns empty models and a null default when no keys are configured', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { models, warnings, defaultModel } = await fetchAllAvailableModels()

    expect(warnings).toEqual([])
    expect(models).toEqual([])
    expect(defaultModel).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('omits unkeyed first-party providers from the catalog', async () => {
    process.env.OPENAI_API_KEY = 'sk-good-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => openaiList(['gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-4o'])),
    )

    const { models, warnings } = await fetchAllAvailableModels()

    expect(warnings).toEqual([])
    expect(models.every((model) => model.provider === 'openai')).toBe(true)
    expect(models.every((model) => model.available)).toBe(true)
    expect(models.every((model) => model.unavailableReason === undefined)).toBe(true)
    expect(models.map((model) => model.id)).toEqual(['openai:gpt-5.6-luna', 'openai:gpt-5.4-mini'])
    expect(models.some((model) => model.provider === 'anthropic')).toBe(false)
    expect(models.some((model) => model.provider === 'google')).toBe(false)
    expect(models.some((model) => model.unavailableReason === 'missing_api_key')).toBe(false)
  })

  it('omits a keyed provider and records a warning when listing fails', async () => {
    process.env.OPENAI_API_KEY = 'sk-bad-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 }),
      ),
    )

    const { models, warnings, defaultModel } = await fetchAllAvailableModels()

    expect(models).toEqual([])
    expect(defaultModel).toBeNull()
    expect(warnings.some((warning) => /invalid|expired|Incorrect API key/i.test(warning))).toBe(
      true,
    )
  })

  it('keeps curated ∩ live ids for openai/anthropic/google', async () => {
    process.env.OPENAI_API_KEY = 'sk-good-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        openaiList([
          'gpt-5.6-luna',
          'gpt-5.4-mini',
          'gpt-4o',
          'text-embedding-3-large',
          'dall-e-3',
          'whisper-1',
        ]),
      ),
    )

    const { models, defaultModel } = await getModelCatalog()

    expect(defaultModel).toBe('openai:gpt-5.6-luna')
    expect(models.find((model) => model.id === 'openai:gpt-5.6-luna')).toMatchObject({
      available: true,
      defaultReasoningEffort: 'medium',
    })
    expect(models.find((model) => model.id === 'openai:gpt-5.4-mini')).toMatchObject({
      available: true,
      defaultReasoningEffort: 'none',
    })
    expect(models.find((model) => model.id === 'openai:gpt-5.6-sol')).toBeUndefined()
    expect(models.find((model) => model.id === 'openai:gpt-4o')).toBeUndefined()
    expect(models.find((model) => model.id === 'openai:text-embedding-3-large')).toBeUndefined()
    expect(models.find((model) => model.id === 'openai:dall-e-3')).toBeUndefined()
    expect(models.find((model) => model.id === 'openai:whisper-1')).toBeUndefined()
  })

  it('lists OpenRouter tools-capable chat models and skips junk', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    process.env.OPENROUTER_API_KEY = 'or-good-key'

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('https://openrouter.ai/api/v1/models')
        return Response.json({
          data: [
            openRouterModel({
              id: 'anthropic/claude-3.5-sonnet',
              name: 'Anthropic: Claude 3.5 Sonnet',
              architecture: {
                input_modalities: ['text', 'image'],
                output_modalities: ['text'],
              },
              supported_parameters: ['tools', 'reasoning'],
            }),
            openRouterModel({
              id: 'openai/gpt-4o-mini',
              name: 'OpenAI: GPT-4o Mini',
              supported_parameters: ['temperature'],
            }),
            openRouterModel({
              id: 'black-forest-labs/flux',
              name: 'FLUX',
              architecture: {
                input_modalities: ['text', 'image'],
                output_modalities: ['image'],
              },
              supported_parameters: ['tools'],
            }),
            openRouterModel({
              id: 'openai/text-embedding-3-large',
              name: 'OpenAI: Text Embedding 3 Large',
              supported_parameters: ['tools'],
            }),
            openRouterModel({
              id: 'openai/gpt-4o-audio',
              name: 'OpenAI: GPT-4o Audio',
              architecture: {
                input_modalities: ['audio'],
                output_modalities: ['audio'],
              },
              supported_parameters: ['tools'],
            }),
          ],
        })
      }),
    )

    const { models, defaultModel, warnings } = await fetchAllAvailableModels()

    expect(warnings).toEqual([])
    expect(models.map((model) => model.id)).toEqual(['openrouter:anthropic/claude-3.5-sonnet'])
    expect(models[0]).toMatchObject({
      provider: 'openrouter',
      modelId: 'anthropic/claude-3.5-sonnet',
      available: true,
      supportsAttachments: true,
      reasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    })
    expect(defaultModel).toBe('openrouter:anthropic/claude-3.5-sonnet')
    expect(
      findCatalogEntryByRef('openrouter:anthropic/claude-3.5-sonnet')?.reasoningTransport,
    ).toBe('openai-effort')
  })

  it('omits a keyed OpenRouter provider and records a warning when listing fails', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    process.env.OPENROUTER_API_KEY = 'or-bad-key'

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { message: 'User not found.' } }, { status: 401 })),
    )

    const { models, warnings, defaultModel } = await fetchAllAvailableModels()

    expect(models).toEqual([])
    expect(defaultModel).toBeNull()
    expect(models.some((model) => model.provider === 'openrouter')).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(typeof warnings[0]).toBe('string')
    expect(warnings[0]).toMatch(/OpenRouter|invalid|expired/i)
  })
})

describe('assertModelAvailable', () => {
  it('rejects refs whose provider has no key or that are not in the available set', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    await expect(assertModelAvailable('openai:gpt-5.6-luna')).rejects.toMatchObject({
      apiError: { code: 'missing_api_key' },
    })
    await expect(
      assertModelAvailable('openrouter:anthropic/claude-3.5-sonnet'),
    ).rejects.toMatchObject({
      apiError: { code: 'missing_api_key' },
    })
    await expect(assertModelAvailable('not-a-provider:xyz')).rejects.toMatchObject({
      apiError: { code: 'missing_api_key' },
    })

    process.env.OPENAI_API_KEY = 'sk-good-key'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => openaiList(['gpt-5.6-luna'])),
    )

    await expect(assertModelAvailable('openai:gpt-5.6-luna')).resolves.toMatchObject({
      id: 'openai:gpt-5.6-luna',
      available: true,
    })
    await expect(assertModelAvailable('openai:gpt-5.6-sol')).rejects.toMatchObject({
      apiError: { code: 'provider_error' },
    })

    clearModelCatalogCache()
    delete process.env.OPENAI_API_KEY
    process.env.OPENROUTER_API_KEY = 'or-good-key'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [openRouterModel({ id: 'anthropic/claude-3.5-sonnet' })],
        }),
      ),
    )

    await expect(
      assertModelAvailable('openrouter:anthropic/claude-3.5-sonnet'),
    ).resolves.toMatchObject({
      id: 'openrouter:anthropic/claude-3.5-sonnet',
      available: true,
    })
    await expect(assertModelAvailable('openrouter:unknown/model')).rejects.toMatchObject({
      apiError: { code: 'provider_error' },
    })
  })
})

describe('catalog cache', () => {
  it('reuses a fresh catalog and refreshes after the TTL', async () => {
    process.env.OPENAI_API_KEY = 'sk-good-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    const fetchMock = vi.fn(async () => openaiList(['gpt-5.6-luna']))
    vi.stubGlobal('fetch', fetchMock)

    await getModelCatalog()
    await getModelCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000 + MODEL_CATALOG_TTL_MS + 1)
    await getModelCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refetches after clearModelCatalogCache, the credential-change invalidate path', async () => {
    process.env.OPENAI_API_KEY = 'sk-good-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    const fetchMock = vi.fn(async () => openaiList(['gpt-5.6-luna']))
    vi.stubGlobal('fetch', fetchMock)

    await getModelCatalog()
    await getModelCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clearModelCatalogCache()
    await getModelCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('default model helpers', () => {
  it('defaults health/env fallback to GPT-5.6 Luna', () => {
    delete process.env.ARK_DEFAULT_MODEL
    expect(getDefaultModel()).toBe(DEFAULT_MODEL_REF)
  })

  it('picks a null catalog default when nothing is available', () => {
    expect(pickCatalogDefaultModel([])).toBeNull()
  })
})
