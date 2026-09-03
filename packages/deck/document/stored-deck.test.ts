import { describe, expect, it } from 'vitest'

import { deckOriginSchema, deckSummarySchema, storedDeckSchema } from './stored-deck.ts'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

const storedDeck = {
  id: deckId,
  html: '<!DOCTYPE html><html><body><section class="slide"></section></body></html>',
  title: 'Untitled',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  documentRevision: 1,
  origin: 'authored' as const,
  filePath: '/tmp/demo.ark',
}

describe('stored deck schemas', () => {
  it('parses a stored deck and its origin', () => {
    expect(deckOriginSchema.parse('blank')).toBe('blank')
    expect(deckOriginSchema.parse('authored')).toBe('authored')
    expect(storedDeckSchema.parse(storedDeck)).toEqual(storedDeck)
  })

  it('omits html and origin from summaries and allows a nullable revision', () => {
    const { html: _html, origin: _origin, ...summaryFields } = storedDeck
    expect(
      deckSummarySchema.parse({
        ...summaryFields,
        documentRevision: null,
        missing: true,
        cover: 'data:image/png;base64,abc',
      }),
    ).toMatchObject({
      id: deckId,
      title: 'Untitled',
      documentRevision: null,
      missing: true,
    })
    expect(deckSummarySchema.safeParse({ ...summaryFields, documentRevision: 0 }).success).toBe(
      false,
    )
    expect(storedDeckSchema.safeParse({ ...storedDeck, origin: 'template' }).success).toBe(false)
  })
})
