import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  catalogSupportsAttachments,
  DEFAULT_MODEL_REF,
  findCatalogEntryByRef,
  MODEL_CATALOG,
  resolveCatalogReasoningEffort,
} from './model-catalog.ts'
import {
  catalogModelAccessible,
  clearModelCatalogCache,
  ensureModelInList,
  fetchAllAvailableModels,
  getDefaultModel,
  getModelCatalog,
} from './models.ts'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  clearModelCatalogCache()

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
  it('marks providers without keys as missing_api_key and does not fetch', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { models, warnings } = await fetchAllAvailableModels()

    expect(warnings).toEqual([])
    expect(models).toHaveLength(MODEL_CATALOG.length)
    expect(models.every((model) => model.available === false)).toBe(true)
    expect(models.every((model) => model.unavailableReason === 'missing_api_key')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks a provider unavailable when its API key is rejected', async () => {
    process.env.OPENAI_API_KEY = 'sk-bad-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 }),
      ),
    )

    const { models, warnings } = await fetchAllAvailableModels()
    const openaiModels = models.filter((model) => model.provider === 'openai')

    expect(openaiModels.every((model) => model.available === false)).toBe(true)
    expect(openaiModels.every((model) => model.unavailableReason === 'not_found')).toBe(true)
    expect(warnings.some((warning) => /invalid|expired|Incorrect API key/i.test(warning))).toBe(
      true,
    )
  })

  it('marks only accessible catalog SKUs available when the key works', async () => {
    process.env.OPENAI_API_KEY = 'sk-good-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [{ id: 'gpt-5.6-luna' }, { id: 'gpt-5.4-mini' }, { id: 'gpt-4o' }],
        }),
      ),
    )

    const { models } = await getModelCatalog()
    const openaiModels = models.filter((model) => model.provider === 'openai')
    const otherModels = models.filter((model) => model.provider !== 'openai')

    expect(openaiModels.find((model) => model.id === 'openai:gpt-5.6-luna')?.available).toBe(true)
    expect(openaiModels.find((model) => model.id === 'openai:gpt-5.4-mini')?.available).toBe(true)
    expect(openaiModels.find((model) => model.id === 'openai:gpt-5.6-sol')?.available).toBe(false)
    expect(openaiModels.find((model) => model.id === 'openai:gpt-5.6-sol')?.unavailableReason).toBe(
      'not_found',
    )
    expect(otherModels.every((model) => !model.available)).toBe(true)
    expect(
      openaiModels.find((model) => model.id === 'openai:gpt-5.4-mini')?.defaultReasoningEffort,
    ).toBe('none')
  })
})

describe('default model helpers', () => {
  it('defaults to GPT-5.6 Luna', () => {
    delete process.env.ARK_DEFAULT_MODEL
    expect(getDefaultModel()).toBe(DEFAULT_MODEL_REF)
  })

  it('ensures unknown defaults appear as unavailable not_found entries', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    const models = ensureModelInList([], 'openai:not-a-real-model')
    expect(models[0]).toMatchObject({
      id: 'openai:not-a-real-model',
      available: false,
      unavailableReason: 'not_found',
      supportsAttachments: true,
    })
  })
})
