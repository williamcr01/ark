import { describe, expect, it, vi } from 'vitest'

import {
  MAX_RUNTIME_ERROR_REPORTS_PER_DECK_VERSION,
  buildRuntimeErrorInput,
  compromiseReasonMessage,
  fingerprintRuntimeError,
  normalizeRuntimeErrorReport,
  shouldReportRuntimeError,
} from './runtime-error-reporting.ts'

describe('runtime-error-reporting', () => {
  it('normalizes and fingerprints messages', () => {
    const normalized = normalizeRuntimeErrorReport('  boom  ', '  src.js  ')
    expect(normalized).toEqual({ message: 'boom', source: 'src.js' })
    expect(fingerprintRuntimeError(normalized.message, normalized.source)).toBe('boom:src.js')
  })

  it('caps reports per deck version except navigation guards', () => {
    const reported = new Set<string>()
    for (let index = 0; index < MAX_RUNTIME_ERROR_REPORTS_PER_DECK_VERSION; index += 1) {
      const fingerprint = `err-${index}:`
      expect(shouldReportRuntimeError(reported, fingerprint, false)).toBe(true)
      reported.add(fingerprint)
    }

    expect(shouldReportRuntimeError(reported, 'overflow:', false)).toBe(false)
    expect(shouldReportRuntimeError(reported, 'guard:preview-navigation-guard', true)).toBe(true)
    expect(shouldReportRuntimeError(reported, 'err-0:', false)).toBe(false)
  })

  it('builds the repair payload and compromise copy', () => {
    const input = buildRuntimeErrorInput(
      {
        deckId: 'deck-1',
        documentRevision: 4,
        slideIndex: 2,
        message: 'ReferenceError: x is not defined',
        source: 'deck.js',
      },
      {
        runtimeMode: 'static',
        previewMode: 'css-only',
        approvedRuntime: undefined,
        validationValid: true,
        validationErrors: 0,
        validationWarnings: 0,
        relatedJobId: 'job-1',
      },
    )

    expect(input.repairContext?.relatedJobId).toBe('job-1')
    expect(input.repairContext?.affectedSlideIndex).toBe(2)
    expect(compromiseReasonMessage('unexpected-load')).toMatch(/unexpected navigation/)
    expect(compromiseReasonMessage('invalid-handshake')).toMatch(/invalid security handshake/)
    expect(compromiseReasonMessage('handshake-timeout')).toMatch(/never completed/)
  })
})

vi.mock('@/lib/api/runtime-error-api', () => ({
  reportRuntimeError: vi.fn().mockResolvedValue({ id: 'err-1' }),
}))
