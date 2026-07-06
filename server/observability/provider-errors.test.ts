import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'

import { categorizeAssetProxyFailure, categorizeProviderError } from './provider-errors.ts'

describe('provider error categorization', () => {
  it('categorizes auth failures as invalid_api_key', () => {
    const error = new APICallError({
      message: 'Incorrect API key provided',
      statusCode: 401,
      url: 'https://api.openai.com/v1/chat/completions',
      requestBodyValues: {},
      responseHeaders: {},
      responseBody: '',
      isRetryable: false,
    })

    expect(categorizeProviderError(error)).toEqual({
      category: 'invalid_api_key',
      apiErrorCode: 'invalid_api_key',
      statusCode: 401,
      retryable: false,
    })
  })

  it('categorizes rate limits as retryable provider errors', () => {
    const error = new APICallError({
      message: 'Rate limit reached for requests',
      statusCode: 429,
      url: 'https://api.openai.com/v1/chat/completions',
      requestBodyValues: {},
      responseHeaders: {},
      responseBody: '',
      isRetryable: true,
    })

    expect(categorizeProviderError(error)).toMatchObject({
      category: 'rate_limit',
      retryable: true,
    })
  })

  it('categorizes asset proxy failures without leaking raw URLs', () => {
    expect(categorizeAssetProxyFailure(new Error('Asset exceeds 5242880 bytes.'))).toBe(
      'size_limit',
    )
    expect(categorizeAssetProxyFailure(new Error('Blocked asset type: application/pdf.'))).toBe(
      'mime_blocked',
    )
    expect(categorizeAssetProxyFailure(new Error('timed out'), 403)).toBe('allowlist_blocked')
  })
})
