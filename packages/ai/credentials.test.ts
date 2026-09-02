import { afterEach, describe, expect, it } from 'vitest'

import { getProviderApiKey, getProviderStatus, setProviderApiKeySource } from './credentials.ts'
import { ALL_PROVIDERS, PROVIDER_ENV_KEYS, providerIdSchema } from './provider-id.ts'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  setProviderApiKeySource(null)

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, ORIGINAL_ENV)
})

describe('OpenRouter credentials', () => {
  it('accepts openrouter as a provider id and env key', () => {
    expect(providerIdSchema.parse('openrouter')).toBe('openrouter')
    expect(providerIdSchema.safeParse('azure').success).toBe(false)
    expect(PROVIDER_ENV_KEYS.openrouter).toBe('OPENROUTER_API_KEY')
    expect([...ALL_PROVIDERS]).toEqual(['openai', 'anthropic', 'google', 'openrouter'])
  })

  it('reads OPENROUTER_API_KEY and ignores placeholders', () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    process.env.OPENROUTER_API_KEY = 'or-secret'

    expect(getProviderApiKey('openrouter')).toBe('or-secret')
    expect(getProviderStatus()).toEqual({
      openai: { configured: false },
      anthropic: { configured: false },
      google: { configured: false },
      openrouter: { configured: true },
    })

    process.env.OPENROUTER_API_KEY = 'your_openrouter_api_key_here'
    expect(getProviderApiKey('openrouter')).toBeNull()
    expect(getProviderStatus().openrouter).toEqual({ configured: false })
  })

  it('reads desktop credential sources including openrouter', () => {
    process.env.OPENROUTER_API_KEY = 'env-should-be-ignored'
    setProviderApiKeySource({
      getApiKey: (provider) => (provider === 'openrouter' ? 'or-desktop-secret' : null),
    })

    expect(getProviderApiKey('openrouter')).toBe('or-desktop-secret')
    expect(getProviderApiKey('openai')).toBeNull()
    expect(getProviderStatus().openrouter).toEqual({ configured: true })
  })
})
