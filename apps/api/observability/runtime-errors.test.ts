import { describe, expect, it } from 'vitest'

import { createRuntimeErrorStore, parseRuntimeErrorBody } from './runtime-errors.ts'

const deckId = '11111111-1111-4111-8111-111111111111'

describe('runtime error reporting', () => {
  it('rejects malformed payloads and oversized messages', () => {
    expect(parseRuntimeErrorBody(null)).toEqual({
      ok: false,
      error: 'Invalid input: expected object, received null',
    })

    expect(parseRuntimeErrorBody({ message: '' })).toEqual({
      ok: false,
      error: 'message is required.',
    })

    const parsed = parseRuntimeErrorBody({
      deckId,
      message: 'x'.repeat(5_000),
      stack: 'y'.repeat(20_000),
      source: 'deck.js',
    })

    expect(parsed.ok).toBe(true)

    if (parsed.ok) {
      expect(parsed.input.message.length).toBeLessThanOrEqual(2_001)
      expect(parsed.input.stack?.length).toBeLessThanOrEqual(8_001)
    }
  })

  it('stores sanitized runtime errors in memory', () => {
    const store = createRuntimeErrorStore(2)

    const first = store.record({
      deckId,
      message: 'Reveal failed to initialize',
      runtimeMode: 'reveal',
      severity: 'error',
      source: 'reveal.js',
    })

    store.record({
      deckId,
      message: 'Second error',
      severity: 'warning',
    })
    store.record({
      deckId,
      message: 'Third error',
      severity: 'info',
    })

    expect(store.listForDeck(deckId)).toHaveLength(2)
    expect(store.listRecent()).toHaveLength(2)
    expect(first.message).toBe('Reveal failed to initialize')
    expect(first.stack).toBeNull()
  })

  it('builds bounded repair context from sanitized authoritative fields', () => {
    const documentRevision = 2
    const parsed = parseRuntimeErrorBody({
      deckId,
      documentRevision,
      slideIndex: 2,
      runtimeMode: 'reveal',
      message: 'Failed with sk-live-secret-value',
      repairContext: {
        errorSummary: 'untrusted summary',
        affectedSlideIndex: 999,
        runtime: {
          mode: 'untrusted',
          previewMode: 'full-js',
          approvedRuntime: { id: 'reveal.js', version: '5.1.0' },
        },
        validation: {
          status: 'invalid',
          errors: 1,
          warnings: 2,
        },
        relatedJobId: '33333333-3333-4333-8333-333333333333',
        documentRevision: null,
        html: '<main>must not be retained</main>',
      },
    })

    expect(parsed.ok).toBe(true)

    if (parsed.ok) {
      expect(parsed.input.message).not.toContain('sk-live-secret-value')
      expect(parsed.input.repairContext).toEqual({
        errorSummary: parsed.input.message,
        affectedSlideIndex: 2,
        runtime: {
          mode: 'reveal',
          previewMode: null,
          approvedRuntime: null,
        },
        validation: {
          status: 'unknown',
          errors: 0,
          warnings: 0,
        },
        relatedJobId: null,
        documentRevision,
      })
      expect(parsed.input.repairContext).not.toHaveProperty('html')
    }
  })
})
