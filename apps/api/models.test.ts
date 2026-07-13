import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchAllAvailableModels } from './models.ts'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, ORIGINAL_ENV)
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
