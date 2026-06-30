import type { ProviderId } from '@/hooks/useAvailableModels'

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
}

export const PROVIDER_ORDER: ProviderId[] = ['openai', 'anthropic', 'google']
