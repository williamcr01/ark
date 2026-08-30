import { describe, expect, it } from 'vitest'

import { formatCspNonceSource, generateCspNonce } from './csp-nonce.ts'

describe('generateCspNonce', () => {
  it('returns a non-empty base64url-ish token', () => {
    const nonce = generateCspNonce()

    expect(nonce.length).toBeGreaterThan(10)
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(nonce).not.toContain('+')
    expect(nonce).not.toContain('/')
    expect(nonce).not.toContain('=')
  })

  it('returns unique values across calls', () => {
    const a = generateCspNonce()
    const b = generateCspNonce()

    expect(a).not.toBe(b)
  })

  it('formats CSP nonce sources', () => {
    expect(formatCspNonceSource('abc')).toBe("'nonce-abc'")
  })
})
