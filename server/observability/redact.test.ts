import { describe, expect, it } from 'vitest'

import {
  redactForLogging,
  redactSecrets,
  sanitizeRuntimeErrorText,
  summarizeHtml,
} from './redact.ts'

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
