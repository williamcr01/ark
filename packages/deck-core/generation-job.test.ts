import { describe, expect, it } from 'vitest'

import { isModelGenerationError } from './generation-job.ts'

describe('isModelGenerationError', () => {
  it('treats auth codes as model failures', () => {
    expect(isModelGenerationError({ code: 'missing_api_key' })).toBe(true)
    expect(isModelGenerationError({ code: 'invalid_api_key' })).toBe(true)
  })

  it('requires errorCategory for provider_error, not the bare API code', () => {
    expect(isModelGenerationError({ code: 'provider_error' })).toBe(false)
    expect(
      isModelGenerationError({ code: 'provider_error', errorCategory: 'provider_error' }),
    ).toBe(true)
    expect(isModelGenerationError({ code: 'provider_error', errorCategory: 'rate_limit' })).toBe(
      true,
    )
  })
})
