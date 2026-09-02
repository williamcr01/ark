import { APICallError } from 'ai'

import { PROVIDER_ENV_KEYS, PROVIDER_LABELS, type ProviderId } from './provider-id.ts'
import type { ProviderErrorCode, ProviderErrorPayload } from './provider-error-code.ts'

export type { ProviderId }
export type { ProviderErrorCode as ApiErrorCode, ProviderErrorPayload as ApiErrorPayload }
export { PROVIDER_ENV_KEYS, PROVIDER_LABELS }

const PLACEHOLDER_API_KEYS = new Set([
  'your_openai_api_key_here',
  'your_anthropic_api_key_here',
  'your_google_api_key_here',
  'your_openrouter_api_key_here',
  'your_key_here',
  'sk-your-key-here',
])

export type ProviderApiKeySource = {
  getApiKey: (provider: ProviderId) => string | null
}

let providerApiKeySource: ProviderApiKeySource | null = null

export function setProviderApiKeySource(source: ProviderApiKeySource | null) {
  providerApiKeySource = source
}

export const getProviderApiKey = (provider: ProviderId): string | null => {
  const apiKey = (
    providerApiKeySource
      ? providerApiKeySource.getApiKey(provider)
      : process.env[PROVIDER_ENV_KEYS[provider]]
  )?.trim()

  if (!apiKey || PLACEHOLDER_API_KEYS.has(apiKey)) {
    return null
  }

  return apiKey
}

export const getConfiguredProviders = (): ProviderId[] =>
  (Object.keys(PROVIDER_ENV_KEYS) as ProviderId[]).filter((provider) =>
    Boolean(getProviderApiKey(provider)),
  )

export const hasAnyConfiguredProvider = () => getConfiguredProviders().length > 0

export const getProviderStatus = () =>
  Object.fromEntries(
    (Object.keys(PROVIDER_ENV_KEYS) as ProviderId[]).map((provider) => [
      provider,
      { configured: Boolean(getProviderApiKey(provider)) },
    ]),
  ) as Record<ProviderId, { configured: boolean }>

export const missingApiKeyError = (): ProviderErrorPayload => ({
  code: 'missing_api_key',
  error: 'No API keys configured. Add a provider key in Settings.',
})

export const invalidApiKeyError = (provider?: ProviderId): ProviderErrorPayload => ({
  code: 'invalid_api_key',
  error: provider
    ? `The ${PROVIDER_LABELS[provider]} API key is invalid or expired. Update it in Settings.`
    : 'A provider API key is invalid or expired. Update it in Settings.',
})

export const parseProviderHttpError = (
  provider: ProviderId,
  status: number,
  body: string,
): ProviderErrorPayload => {
  if (status === 401 || status === 403) {
    return invalidApiKeyError(provider)
  }

  let message = body.trim()

  if (message) {
    try {
      const parsed = JSON.parse(message) as {
        error?: { message?: string }
        message?: string
      }
      message = parsed.error?.message?.trim() || parsed.message?.trim() || message
    } catch {
      // Keep the raw body when it is not JSON.
    }
  }

  if (
    status === 401 ||
    /incorrect api key/i.test(message) ||
    /invalid api key/i.test(message) ||
    /api key not valid/i.test(message)
  ) {
    return invalidApiKeyError(provider)
  }

  return {
    code: 'provider_error',
    error:
      message ||
      `${PROVIDER_LABELS[provider]} request failed with status ${status}. Check your API key and account access.`,
  }
}

export const parseProviderError = (error: unknown): ProviderErrorPayload => {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return invalidApiKeyError()
    }

    const message = error.message.trim()

    if (
      /incorrect api key/i.test(message) ||
      /invalid api key/i.test(message) ||
      /api key not valid/i.test(message)
    ) {
      return invalidApiKeyError()
    }

    return {
      code: 'provider_error',
      error: message || 'Model provider request failed.',
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim()

    if (
      /incorrect api key/i.test(message) ||
      /invalid api key/i.test(message) ||
      /api key not valid/i.test(message)
    ) {
      return invalidApiKeyError()
    }

    return {
      code: 'provider_error',
      error: message || 'Unknown generation error.',
    }
  }

  return {
    code: 'provider_error',
    error: 'Unknown generation error.',
  }
}
