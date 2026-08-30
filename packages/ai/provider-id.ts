import { z } from 'zod'

export const providerIdSchema = z.enum(['openai', 'anthropic', 'google'])

export type ProviderId = z.infer<typeof providerIdSchema>

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
}

export const PROVIDER_ENV_KEYS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
}
