import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearModelCatalogCache,
  fetchAllAvailableModels,
  fetchProviderModels,
  getModelCatalog,
  isAnthropicChatModel,
  isGoogleChatModel,
  isOpenAIChatModel,
  refreshModelCatalog,
} from './models.ts'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearModelCatalogCache()

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, ORIGINAL_ENV)
})

describe('provider chat model filters', () => {
  it('keeps OpenAI chat models and drops media/specialty SKUs', () => {
    expect(isOpenAIChatModel('gpt-4o-mini')).toBe(true)
    expect(isOpenAIChatModel('o3-mini')).toBe(true)
    expect(isOpenAIChatModel('chatgpt-4o-latest')).toBe(true)

    expect(isOpenAIChatModel('dall-e-3')).toBe(false)
    expect(isOpenAIChatModel('gpt-image-1')).toBe(false)
    expect(isOpenAIChatModel('text-embedding-3-large')).toBe(false)
    expect(isOpenAIChatModel('whisper-1')).toBe(false)
    expect(isOpenAIChatModel('tts-1')).toBe(false)
    expect(isOpenAIChatModel('sora-2')).toBe(false)
    expect(isOpenAIChatModel('gpt-4o-realtime-preview')).toBe(false)
  })

  it('keeps Anthropic Claude chat models and drops non-chat names', () => {
    expect(isAnthropicChatModel('claude-sonnet-5')).toBe(true)
    expect(isAnthropicChatModel('claude-haiku-4-5-20251001')).toBe(true)

    expect(isAnthropicChatModel('claude-embedding-1')).toBe(false)
    expect(isAnthropicChatModel('not-claude')).toBe(false)
  })

  it('keeps stable Gemini chat models and drops image/preview/revision SKUs', () => {
    expect(isGoogleChatModel('gemini-2.5-flash')).toBe(true)
    expect(isGoogleChatModel('gemini-2.5-flash-lite')).toBe(true)
    expect(isGoogleChatModel('gemini-2.5-pro')).toBe(true)
    expect(isGoogleChatModel('gemini-3.5-flash')).toBe(true)
    expect(isGoogleChatModel('gemini-2.0-flash')).toBe(true)

    expect(isGoogleChatModel('gemini-2.0-flash-preview-image-generation')).toBe(false)
    expect(isGoogleChatModel('gemini-embedding-001')).toBe(false)
    expect(isGoogleChatModel('gemini-2.5-flash-preview-05-20')).toBe(false)
    expect(isGoogleChatModel('gemini-exp-1206')).toBe(false)
    expect(isGoogleChatModel('gemini-1.5-flash-001')).toBe(false)
    expect(isGoogleChatModel('imagen-3.0-generate-002')).toBe(false)
  })
})

describe('fetchProviderModels filtering', () => {
  it('filters Google list models through isGoogleChatModel', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key'
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash-lite',
              displayName: 'Gemini 2.5 Flash Lite',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.0-flash-preview-image-generation',
              displayName: 'Image Gen',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-embedding-001',
              displayName: 'Embedding',
              supportedGenerationMethods: ['embedContent', 'generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash-preview-05-20',
              displayName: 'Preview',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/imagen-3.0-generate-002',
              displayName: 'Imagen',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      ),
    )

    const models = await fetchProviderModels('google')
    expect(models.map((model) => model.modelId).sort()).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ])
  })

  it('filters Anthropic list models through isAnthropicChatModel', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
            { id: 'claude-embedding-1', display_name: 'Claude Embedding' },
            { id: 'some-other-model', display_name: 'Other' },
          ],
          has_more: false,
        }),
      ),
    )

    const models = await fetchProviderModels('anthropic')
    expect(models.map((model) => model.modelId)).toEqual(['claude-sonnet-5'])
  })

  it('filters OpenAI list models through isOpenAIChatModel', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { id: 'gpt-4o-mini' },
            { id: 'dall-e-3' },
            { id: 'gpt-image-1' },
            { id: 'text-embedding-3-small' },
            { id: 'o3-mini' },
          ],
        }),
      ),
    )

    const models = await fetchProviderModels('openai')
    expect(models.map((model) => model.modelId).sort()).toEqual(['gpt-4o-mini', 'o3-mini'])
  })
})

describe('fetchAllAvailableModels', () => {
  it('seeds missing-key providers as unavailable with missing_api_key', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    const { models, warnings } = await fetchAllAvailableModels()

    expect(warnings).toEqual([])
    expect(models.every((model) => model.available === false)).toBe(true)
    expect(models.every((model) => model.unavailableReason === 'missing_api_key')).toBe(true)
    expect(models.some((model) => model.id === 'google:gemini-3.5-flash')).toBe(true)
    expect(models.some((model) => model.id === 'anthropic:claude-sonnet-5')).toBe(true)
  })

  it('marks seed models not_found and records a warning when a provider list fails', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key'

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'API key not valid. Please pass a valid API key.' } },
          { status: 400 },
        ),
      ),
    )

    const { models, warnings } = await fetchAllAvailableModels()

    const googleModels = models.filter((model) => model.provider === 'google')
    expect(googleModels.length).toBeGreaterThan(0)
    expect(googleModels.every((model) => model.available === false)).toBe(true)
    expect(googleModels.every((model) => model.unavailableReason === 'not_found')).toBe(true)
    expect(warnings.some((warning) => /invalid or expired|api key/i.test(warning))).toBe(true)
  })

  it('turns raw network fetch failures into provider-scoped catalog warnings', async () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key'

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const { models, warnings } = await fetchAllAvailableModels()

    expect(warnings.sort()).toEqual(
      [
        'Could not reach Gemini to load models. Showing fallback models until the network is available.',
        'Could not reach OpenAI to load models. Showing fallback models until the network is available.',
      ].sort(),
    )
    expect(
      models.filter((model) => model.provider === 'openai').every((model) => !model.available),
    ).toBe(true)
    expect(
      models.filter((model) => model.provider === 'google').every((model) => !model.available),
    ).toBe(true)
  })
})

describe('model catalog cache', () => {
  it('serves the warmed catalog without re-fetching providers', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

    const fetchMock = vi.fn(async () => {
      throw new Error('provider fetch should not run without API keys')
    })
    vi.stubGlobal('fetch', fetchMock)

    const warmed = await refreshModelCatalog()
    const cached = await getModelCatalog()

    expect(cached).toBe(warmed)
    expect(cached.models.length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shares one in-flight refresh when the cache is cold', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key'

    let resolveFetch: ((value: Response) => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolveResponse) => {
              resolve()
              resolveFetch = resolveResponse
            }),
        ),
      )
    })

    const first = getModelCatalog()
    const second = getModelCatalog()

    await fetchStarted
    resolveFetch?.(
      Response.json({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    )

    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a.models.some((model) => model.id === 'google:gemini-2.5-flash')).toBe(true)
  })
})
