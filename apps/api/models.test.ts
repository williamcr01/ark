import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  catalogSupportsAttachments,
  DEFAULT_MODEL_REF,
  findCatalogEntryByRef,
  MODEL_CATALOG,
  resolveCatalogReasoningEffort,
} from './model-catalog.ts'
import {
  ensureModelInList,
  fetchAllAvailableModels,
  getDefaultModel,
  getModelCatalog,
} from './models.ts'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, ORIGINAL_ENV)
})

describe('curated model catalog', () => {
  it('contains exactly the issue #211 models in provider order', () => {
    expect(MODEL_CATALOG.map((entry) => `${entry.provider}:${entry.modelId}`)).toEqual([
      'openai:gpt-5.6-sol',
      'openai:gpt-5.6-terra',
      'openai:gpt-5.6-luna',
      'openai:gpt-5.5',
      'openai:gpt-5.4-mini',
      'anthropic:claude-fable-5',
      'anthropic:claude-opus-4-8',
      'anthropic:claude-sonnet-5',
      'anthropic:claude-haiku-4-5',
      'google:gemini-3.6-flash',
      'google:gemini-3.5-flash',
      'google:gemini-3.1-pro-preview',
      'google:gemini-2.5-flash',
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
      'minimal',
      'low',
      'medium',
      'high',
    ])
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

describe('fetchAllAvailableModels', () => {
  it('marks providers without keys as missing_api_key and never fetches provider APIs', async () => {
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
    expect(models.every((model) => Array.isArray(model.reasoningEfforts))).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks a provider available when its API key is configured', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    const { models } = await getModelCatalog()
    const openaiModels = models.filter((model) => model.provider === 'openai')
    const otherModels = models.filter((model) => model.provider !== 'openai')

    expect(openaiModels.every((model) => model.available)).toBe(true)
    expect(otherModels.every((model) => !model.available)).toBe(true)
    expect(
      openaiModels.find((model) => model.id === 'openai:gpt-5.6-luna')?.supportsReasoning,
    ).toBe(true)
    expect(
      openaiModels.find((model) => model.id === 'openai:gpt-5.4-mini')?.supportsReasoning,
    ).toBe(true)
    expect(
      openaiModels.find((model) => model.id === 'openai:gpt-5.4-mini')?.supportsAttachments,
    ).toBe(true)
    expect(
      openaiModels.find((model) => model.id === 'openai:gpt-5.4-mini')?.defaultReasoningEffort,
    ).toBe('none')
  })
})

describe('default model helpers', () => {
  it('defaults to GPT-5.6 Luna', () => {
    delete process.env.ARK_DEFAULT_MODEL
    delete process.env.OPENAI_MODEL
    expect(getDefaultModel()).toBe(DEFAULT_MODEL_REF)
  })

  it('ensures unknown defaults appear as unavailable not_found entries', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    const models = ensureModelInList([], 'openai:not-a-real-model')
    expect(models[0]).toMatchObject({
      id: 'openai:not-a-real-model',
      available: false,
      unavailableReason: 'not_found',
      supportsReasoning: false,
    })
  })
})
