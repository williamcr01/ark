import { APICallError } from 'ai'

export type ApiErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'openai_error'

export type ApiErrorPayload = {
  error: string
  code: ApiErrorCode
}

const PLACEHOLDER_API_KEYS = new Set([
  'your_openai_api_key_here',
  'your_key_here',
  'sk-your-key-here',
])

export const getConfiguredApiKey = (): string | null => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()

  if (!apiKey || PLACEHOLDER_API_KEYS.has(apiKey)) {
    return null
  }

  return apiKey
}

export const missingApiKeyError = (): ApiErrorPayload => ({
  code: 'missing_api_key',
  error:
    'Missing OPENAI_API_KEY. Copy .env.example to .env, add your key, and restart the dev server.',
})

export const invalidApiKeyError = (): ApiErrorPayload => ({
  code: 'invalid_api_key',
  error:
    'The OpenAI API key in .env is invalid or expired. Check OPENAI_API_KEY and restart the dev server.',
})

export const parseOpenAIHttpError = (
  status: number,
  body: string,
): ApiErrorPayload => {
  if (status === 401) {
    return invalidApiKeyError()
  }

  let message = body.trim()

  if (message) {
    try {
      const parsed = JSON.parse(message) as {
        error?: { message?: string }
      }
      message = parsed.error?.message?.trim() || message
    } catch {
      // Keep the raw body when it is not JSON.
    }
  }

  if (status === 401 || /incorrect api key/i.test(message)) {
    return invalidApiKeyError()
  }

  return {
    code: 'openai_error',
    error:
      message ||
      `OpenAI request failed with status ${status}. Check your API key and account access.`,
  }
}

export const parseProviderError = (error: unknown): ApiErrorPayload => {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401) {
      return invalidApiKeyError()
    }

    const message = error.message.trim()

    if (/incorrect api key/i.test(message) || /invalid api key/i.test(message)) {
      return invalidApiKeyError()
    }

    return {
      code: 'openai_error',
      error: message || 'OpenAI request failed.',
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim()

    if (/incorrect api key/i.test(message) || /invalid api key/i.test(message)) {
      return invalidApiKeyError()
    }

    return {
      code: 'openai_error',
      error: message || 'Unknown generation error.',
    }
  }

  return {
    code: 'openai_error',
    error: 'Unknown generation error.',
  }
}
