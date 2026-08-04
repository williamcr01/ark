import { describe, expect, it } from 'vitest'
import {
  redactForLogging,
  redactSecrets,
  sanitizeRuntimeErrorText,
  summarizeHtml,
} from './redact.ts'
import { APICallError } from 'ai'
import { categorizeAssetProxyFailure, categorizeProviderError } from './provider-errors.ts'
import { createLogger, type StructuredLogEntry } from './logger.ts'
import { logTimedEvent, measureAsync, measureSync } from './timing.ts'
import { createRuntimeErrorStore, parseRuntimeErrorBody } from './runtime-errors.ts'

describe('observability redact helpers', () => {
  it('redacts common API key patterns', () => {
    const input = 'Bearer sk-abcdefghijklmnopqrstuvwxyz and AIzaSyD-example-key-1234567890'

    expect(redactSecrets(input)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(redactSecrets(input)).toContain('[REDACTED_SECRET]')
  })

  it('summarizes HTML without returning the full document', () => {
    const html = `<!DOCTYPE html><html><body>${'x'.repeat(500)}</body></html>`
    const summary = summarizeHtml(html)

    expect(summary.length).toBe(html.length)
    expect(summary.preview.length).toBeLessThan(html.length)
    expect(summary.preview.endsWith('…')).toBe(true)
  })

  it('redacts sensitive fields for structured logging', () => {
    const redacted = redactForLogging({
      deckId: 'deck-1',
      html: '<html><body>secret deck</body></html>',
      messages: [{ role: 'user', content: 'make slides' }],
      apiKey: 'sk-should-not-appear',
    }) as Record<string, unknown>

    expect(redacted.deckId).toBe('deck-1')
    expect(redacted.html).toEqual({
      length: expect.any(Number),
      preview: expect.any(String),
    })
    expect(redacted.messages).toEqual({
      count: 1,
      roles: ['user'],
    })
    expect(redacted.apiKey).toBe('[REDACTED_FIELD]')
  })

  it('sanitizes runtime error text and enforces size limits', () => {
    const sanitized = sanitizeRuntimeErrorText(`bad\u0000input ${'x'.repeat(3_000)}`, 100)

    expect(sanitized).not.toContain('\u0000')
    expect(sanitized.length).toBeLessThanOrEqual(101)
    expect(sanitized.endsWith('…')).toBe(true)
  })
})

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

describe('observability timing helpers', () => {
  it('measures synchronous work', () => {
    const { result, durationMs } = measureSync(() => 42)

    expect(result).toBe(42)
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it('measures asynchronous work', async () => {
    const { result, durationMs } = await measureAsync(async () => {
      await Promise.resolve()
      return 'done'
    })

    expect(result).toBe('done')
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it('logs timed events with durationMs', () => {
    const entries: StructuredLogEntry[] = []
    const logger = createLogger({
      write: (entry) => entries.push(entry),
    })

    logTimedEvent(logger, 'deck.parse.completed', 17, {
      slideCount: 3,
      htmlBytes: 1024,
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'deck.parse.completed',
      durationMs: 17,
      fields: {
        slideCount: 3,
        htmlBytes: 1024,
      },
    })
  })
})

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
