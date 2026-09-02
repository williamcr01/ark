import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DOCUMENT_HISTORY_LIMITS,
  DEFAULT_DOCUMENT_HISTORY_SOURCE,
  DOCUMENT_HISTORY_MAX_BYTES,
  DOCUMENT_HISTORY_MAX_ENTRIES,
  DOCUMENT_HISTORY_SOURCES,
  documentHistorySourceSchema,
  documentHistorySummarySchema,
  isDocumentHistorySource,
  normalizeDocumentHistorySource,
} from './document-history.ts'

describe('document history schemas', () => {
  it('accepts the durable source tags and rejects unknown ones', () => {
    expect(DOCUMENT_HISTORY_SOURCES).toEqual([
      'editor',
      'agent',
      'mcp',
      'import',
      'create',
      'restore',
    ])
    for (const source of DOCUMENT_HISTORY_SOURCES) {
      expect(documentHistorySourceSchema.parse(source)).toBe(source)
      expect(isDocumentHistorySource(source)).toBe(true)
    }
    expect(isDocumentHistorySource('generation_job')).toBe(false)
    expect(documentHistorySourceSchema.safeParse('generation_job').success).toBe(false)
    expect(normalizeDocumentHistorySource('mcp')).toBe('mcp')
    expect(normalizeDocumentHistorySource('nope')).toBe(DEFAULT_DOCUMENT_HISTORY_SOURCE)
  })

  it('parses history summaries and keeps the snapshot budget constants', () => {
    expect(DEFAULT_DOCUMENT_HISTORY_LIMITS).toEqual({
      maxEntries: DOCUMENT_HISTORY_MAX_ENTRIES,
      maxBytes: DOCUMENT_HISTORY_MAX_BYTES,
    })
    expect(DOCUMENT_HISTORY_MAX_ENTRIES).toBe(50)
    expect(DOCUMENT_HISTORY_MAX_BYTES).toBe(8 * 1024 * 1024)
    expect(
      documentHistorySummarySchema.parse({
        revision: 2,
        source: 'editor',
        createdAt: '2026-09-01T00:00:00.000Z',
        byteSize: 120,
      }),
    ).toEqual({
      revision: 2,
      source: 'editor',
      createdAt: '2026-09-01T00:00:00.000Z',
      byteSize: 120,
    })
    expect(
      documentHistorySummarySchema.safeParse({
        revision: 1,
        source: 'generation_job',
        createdAt: '2026-09-01T00:00:00.000Z',
        byteSize: 120,
      }).success,
    ).toBe(false)
  })
})
