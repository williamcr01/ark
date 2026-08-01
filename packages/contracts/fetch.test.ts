import { describe, expect, it } from 'vitest'

import { ApiResponseError, parseApiResponse } from './fetch.ts'
import { deckResponseSchema } from './decks.ts'

describe('shared API fetch helpers', () => {
  it('parses successful responses through schemas', () => {
    const deck = {
      id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
      html: '<html></html>',
      title: 'Deck',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeVersionId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
      versionNumber: 1,
    }

    expect(parseApiResponse(deckResponseSchema, { deck })).toEqual({ deck })
  })

  it('throws ApiResponseError for simple error payloads', () => {
    expect(() => parseApiResponse(deckResponseSchema, { error: 'Deck not found.' })).toThrow(
      ApiResponseError,
    )
  })

  it('throws ApiResponseError with provider codes', () => {
    try {
      parseApiResponse(deckResponseSchema, {
        error: 'Missing key',
        code: 'missing_api_key',
      })
      expect.fail('expected parseApiResponse to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiResponseError)
      expect((error as ApiResponseError).code).toBe('missing_api_key')
    }
  })
})
