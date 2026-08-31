import { describe, expect, it } from 'vitest'

import { exportFileName, parseDeckExportRequest, toExportFileStem } from './deck-export-request.ts'

const validRequest = { format: 'pdf', html: '<html></html>', title: 'Quarterly Review' }

describe('parseDeckExportRequest', () => {
  it('accepts a well-formed PDF request', () => {
    expect(parseDeckExportRequest(validRequest)).toEqual(validRequest)
  })

  it('drops unknown properties rather than forwarding them', () => {
    expect(parseDeckExportRequest({ ...validRequest, filePath: '/etc/passwd' })).toEqual(
      validRequest,
    )
  })

  it.each([
    ['a non-object', null, 'Invalid export request.'],
    ['an unknown format', { ...validRequest, format: 'pptx' }, 'Unsupported export format.'],
    ['a missing format', { html: '<html></html>', title: '' }, 'Unsupported export format.'],
    ['blank html', { ...validRequest, html: '   ' }, 'This deck has no content to export.'],
    ['a non-string title', { ...validRequest, title: 7 }, 'Invalid deck title.'],
  ])('rejects %s', (_name, value, message) => {
    expect(() => parseDeckExportRequest(value)).toThrow(message)
  })

  it('rejects decks past the size ceiling', () => {
    expect(() => parseDeckExportRequest({ ...validRequest, html: 'x'.repeat(20_000_001) })).toThrow(
      'This deck is too large to export.',
    )
  })
})

describe('toExportFileStem', () => {
  it.each([
    ['Q3 Review', 'Q3 Review'],
    ['Sales: 2026/27 <draft>', 'Sales 2026 27 draft'],
    ['tab\tand\nnewline', 'tab and newline'],
    ['  padded  ', 'padded'],
    ['trailing dots...', 'trailing dots'],
    ['...leading dots', 'leading dots'],
    ['', 'Untitled Presentation'],
    ['///', 'Untitled Presentation'],
    ['CON', 'Untitled Presentation'],
    ['lpt1', 'Untitled Presentation'],
  ])('maps %j to %j', (title, expected) => {
    expect(toExportFileStem(title)).toBe(expected)
  })

  it('truncates long titles without leaving a trailing separator', () => {
    const stem = toExportFileStem(`${'a'.repeat(119)}. tail`)

    expect(stem.length).toBeLessThanOrEqual(120)
    expect(stem).toBe('a'.repeat(119))
  })

  it('keeps astral characters intact', () => {
    expect(toExportFileStem('Roadmap 🚀')).toBe('Roadmap 🚀')
  })
})

describe('exportFileName', () => {
  it('appends the format as the extension', () => {
    expect(exportFileName('Quarterly Review', 'pdf')).toBe('Quarterly Review.pdf')
  })
})
