import { z } from 'zod'

export const ALL_PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter'] as const

export const providerIdSchema = z.enum(ALL_PROVIDERS)

export type ProviderId = z.infer<typeof providerIdSchema>

export const FIRST_PARTY_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
] as const satisfies readonly ProviderId[]

export type FirstPartyProviderId = (typeof FIRST_PARTY_PROVIDERS)[number]

export const isFirstPartyProvider = (provider: ProviderId): provider is FirstPartyProviderId =>
  provider !== 'openrouter'

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  openrouter: 'OpenRouter',
}

export const PROVIDER_ENV_KEYS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}
