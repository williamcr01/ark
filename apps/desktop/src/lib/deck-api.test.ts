import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeck, fetchDeck, listDecks, renameDeck, updateDeck } from './deck-api'

const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  html: '<!DOCTYPE html><html><head><title>Deck</title></head><body></body></html>',
  title: 'Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  documentRevision: 1,
  filePath: '/tmp/Deck.ark',
}

const deckSummary = {
  id: deck.id,
  title: deck.title,
  createdAt: deck.createdAt,
  updatedAt: deck.updatedAt,
  documentRevision: deck.documentRevision,
  filePath: deck.filePath,
}

const jsonResponse = (body: unknown, options: { ok?: boolean; status?: number } = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => body,
})

describe('deck-api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists deck summaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ decks: [deckSummary] }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(listDecks()).resolves.toEqual([deckSummary])
    expect(fetchMock).toHaveBeenCalledWith('/api/decks')
  })

  it('reads full deck responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchDeck(deck.id)).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenCalledWith(`/api/decks/${deck.id}`)
  })

  it('creates decks with HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }, { status: 201 }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(createDeck(deck.html)).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/decks',
      expect.objectContaining({
        body: JSON.stringify({ html: deck.html }),
        method: 'POST',
      }),
    )
  })

  it('updates the current document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(updateDeck(deck.id, deck.html)).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({
        body: JSON.stringify({ html: deck.html }),
        method: 'PUT',
      }),
    )
  })

  it('renames deck metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck: { ...deck, title: 'Plan' } }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(renameDeck(deck.id, 'Plan')).resolves.toMatchObject({ title: 'Plan' })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({
        body: JSON.stringify({ title: 'Plan' }),
        method: 'PATCH',
      }),
    )
  })

  it('surfaces API errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Deck not found.' }, { ok: false, status: 404 }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchDeck(deck.id)).rejects.toThrow('Deck not found.')
  })
})
