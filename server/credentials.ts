import { APICallError } from 'ai'

export type ProviderId = 'openai' | 'anthropic' | 'google'

export type ApiErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'provider_error'

export type ApiErrorPayload = {
  error: string
  code: ApiErrorCode
}

const PLACEHOLDER_API_KEYS = new Set([
  'your_openai_api_key_here',
  'your_anthropic_api_key_here',
  'your_google_api_key_here',
  'your_key_here',
  'sk-your-key-here',
])

const PROVIDER_ENV_KEYS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
}

export const getProviderApiKey = (provider: ProviderId): string | null => {
  const apiKey = process.env[PROVIDER_ENV_KEYS[provider]]?.trim()

  if (!apiKey || PLACEHOLDER_API_KEYS.has(apiKey)) {
    return null
  }

  return apiKey
}

export const getConfiguredProviders = (): ProviderId[] =>
  (Object.keys(PROVIDER_ENV_KEYS) as ProviderId[]).filter(
    (provider) => Boolean(getProviderApiKey(provider)),
  )

export const hasAnyConfiguredProvider = () => getConfiguredProviders().length > 0

export const getProviderStatus = () =>
  Object.fromEntries(
    (Object.keys(PROVIDER_ENV_KEYS) as ProviderId[]).map((provider) => [
      provider,
      { configured: Boolean(getProviderApiKey(provider)) },
    ]),
  ) as Record<ProviderId, { configured: boolean }>

export const missingApiKeyError = (): ApiErrorPayload => ({
  code: 'missing_api_key',
  error:
    'No API keys configured. Add at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY to .env and restart the dev server.',
})

export const invalidApiKeyError = (provider?: ProviderId): ApiErrorPayload => ({
  code: 'invalid_api_key',
  error: provider
    ? `The ${PROVIDER_LABELS[provider]} API key in .env is invalid or expired. Check ${PROVIDER_ENV_KEYS[provider]} and restart the dev server.`
    : 'An API key in .env is invalid or expired. Check your provider keys and restart the dev server.',
})

export const parseProviderHttpError = (
  provider: ProviderId,
  status: number,
  body: string,
): ApiErrorPayload => {
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
      message =
        parsed.error?.message?.trim() ||
        parsed.message?.trim() ||
        message
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

export const parseProviderError = (error: unknown): ApiErrorPayload => {
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

// Backward compatibility for older imports.
export const getConfiguredApiKey = () => getProviderApiKey('openai')
export const parseOpenAIHttpError = (status: number, body: string) =>
  parseProviderHttpError('openai', status, body)
