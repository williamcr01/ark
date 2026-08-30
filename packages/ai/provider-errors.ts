import { APICallError } from 'ai'

import type { ApiErrorCode } from './credentials.ts'

export type ProviderErrorCategory =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'rate_limit'
  | 'context_length'
  | 'content_filter'
  | 'timeout'
  | 'network'
  | 'aborted'
  | 'provider_error'

export type ProviderErrorDetails = {
  category: ProviderErrorCategory
  apiErrorCode: ApiErrorCode
  statusCode?: number | null
  retryable: boolean
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.trim()
  }

  if (typeof error === 'string') {
    return error.trim()
  }

  return ''
}

function matchesAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message))
}

export function categorizeProviderError(error: unknown): ProviderErrorDetails {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      category: 'aborted',
      apiErrorCode: 'provider_error',
      retryable: true,
    }
  }

  if (APICallError.isInstance(error)) {
    const message = error.message.trim()
    const statusCode = error.statusCode ?? null

    if (statusCode === 401 || statusCode === 403) {
      return {
        category: 'invalid_api_key',
        apiErrorCode: 'invalid_api_key',
        statusCode,
        retryable: false,
      }
    }

    if (
      statusCode === 429 ||
      matchesAny(message, [/rate limit/i, /too many requests/i, /quota exceeded/i])
    ) {
      return {
        category: 'rate_limit',
        apiErrorCode: 'provider_error',
        statusCode,
        retryable: true,
      }
    }

    if (
      statusCode === 400 &&
      matchesAny(message, [/context length/i, /maximum context/i, /token limit/i, /too long/i])
    ) {
      return {
        category: 'context_length',
        apiErrorCode: 'provider_error',
        statusCode,
        retryable: false,
      }
    }

    if (matchesAny(message, [/content policy/i, /content filter/i, /safety/i, /moderation/i])) {
      return {
        category: 'content_filter',
        apiErrorCode: 'provider_error',
        statusCode,
        retryable: false,
      }
    }

    if (matchesAny(message, [/timed out/i, /timeout/i, /deadline exceeded/i])) {
      return {
        category: 'timeout',
        apiErrorCode: 'provider_error',
        statusCode,
        retryable: true,
      }
    }

    if (matchesAny(message, [/network/i, /fetch failed/i, /econnreset/i, /enotfound/i])) {
      return {
        category: 'network',
        apiErrorCode: 'provider_error',
        statusCode,
        retryable: true,
      }
    }

    return {
      category: 'provider_error',
      apiErrorCode: 'provider_error',
      statusCode,
      retryable: false,
    }
  }

  const message = readErrorMessage(error)

  if (!message) {
    return {
      category: 'provider_error',
      apiErrorCode: 'provider_error',
      retryable: false,
    }
  }

  if (matchesAny(message, [/missing api key/i, /no api keys configured/i, /api key required/i])) {
    return {
      category: 'missing_api_key',
      apiErrorCode: 'missing_api_key',
      retryable: false,
    }
  }

  if (matchesAny(message, [/incorrect api key/i, /invalid api key/i, /api key not valid/i])) {
    return {
      category: 'invalid_api_key',
      apiErrorCode: 'invalid_api_key',
      retryable: false,
    }
  }

  if (matchesAny(message, [/rate limit/i, /too many requests/i, /quota exceeded/i])) {
    return {
      category: 'rate_limit',
      apiErrorCode: 'provider_error',
      retryable: true,
    }
  }

  if (matchesAny(message, [/context length/i, /maximum context/i, /token limit/i, /too long/i])) {
    return {
      category: 'context_length',
      apiErrorCode: 'provider_error',
      retryable: false,
    }
  }

  if (matchesAny(message, [/content policy/i, /content filter/i, /safety/i, /moderation/i])) {
    return {
      category: 'content_filter',
      apiErrorCode: 'provider_error',
      retryable: false,
    }
  }

  if (matchesAny(message, [/timed out/i, /timeout/i, /deadline exceeded/i])) {
    return {
      category: 'timeout',
      apiErrorCode: 'provider_error',
      retryable: true,
    }
  }

  if (matchesAny(message, [/network/i, /fetch failed/i, /econnreset/i, /enotfound/i])) {
    return {
      category: 'network',
      apiErrorCode: 'provider_error',
      retryable: true,
    }
  }

  if (matchesAny(message, [/generation canceled/i, /aborted/i])) {
    return {
      category: 'aborted',
      apiErrorCode: 'provider_error',
      retryable: true,
    }
  }

  return {
    category: 'provider_error',
    apiErrorCode: 'provider_error',
    retryable: false,
  }
}

export type AssetProxyFailureCategory =
  | 'missing_url'
  | 'invalid_url'
  | 'allowlist_blocked'
  | 'upstream_error'
  | 'mime_blocked'
  | 'size_limit'
  | 'timeout'
  | 'network'
  | 'unknown'

export function categorizeAssetProxyFailure(error: unknown, statusCode?: number) {
  const message = readErrorMessage(error)

  if (statusCode === 403) {
    return 'allowlist_blocked' as const
  }

  if (message.includes('url query parameter is required')) {
    return 'missing_url' as const
  }

  if (message.includes('valid absolute http(s) URL')) {
    return 'invalid_url' as const
  }

  if (message.includes('Blocked asset type')) {
    return 'mime_blocked' as const
  }

  if (message.includes('exceeds') && message.includes('bytes')) {
    return 'size_limit' as const
  }

  if (matchesAny(message, [/timed out/i, /timeout/i, /aborted/i])) {
    return 'timeout' as const
  }

  if (matchesAny(message, [/Upstream responded with/i])) {
    return 'upstream_error' as const
  }

  if (matchesAny(message, [/network/i, /fetch failed/i])) {
    return 'network' as const
  }

  return 'unknown' as const
}
