import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDeck,
  fetchDeck,
  fetchDeckVersion,
  listDeckVersions,
  listDecks,
  renameDeck,
  rollbackDeck,
} from './deck-api'

const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  html: '<!DOCTYPE html><html><head><title>Deck</title></head><body></body></html>',
  title: 'Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const deckSummary = {
  id: deck.id,
  title: deck.title,
  createdAt: deck.createdAt,
  updatedAt: deck.updatedAt,
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

    await expect(createDeck(deck.html, { source: 'upload' })).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/decks',
      expect.objectContaining({
        body: JSON.stringify({ html: deck.html, source: 'upload' }),
        method: 'POST',
      }),
    )
  })

  it('lists deck versions and fetches one version', async () => {
    const version = {
      id: 'a0000000-0000-4000-8000-000000000001',
      deckId: deck.id,
      versionNumber: 1,
      title: deck.title,
      source: 'manual' as const,
      summary: null,
      validationStatus: 'valid' as const,
      runtimeManifest: null,
      createdAt: deck.createdAt,
      isActive: true,
      html: deck.html,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ versions: [version] }))
      .mockResolvedValueOnce(jsonResponse({ version }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(listDeckVersions(deck.id)).resolves.toEqual([
      {
        id: version.id,
        deckId: version.deckId,
        versionNumber: version.versionNumber,
        title: version.title,
        source: version.source,
        summary: version.summary,
        validationStatus: version.validationStatus,
        runtimeManifest: version.runtimeManifest,
        createdAt: version.createdAt,
        isActive: version.isActive,
      },
    ])
    await expect(fetchDeckVersion(deck.id, version.id)).resolves.toEqual(version)
  })

  it('rolls back to a prior version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(rollbackDeck(deck.id, 'a0000000-0000-4000-8000-000000000001')).resolves.toEqual(
      deck,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}/rollback`,
      expect.objectContaining({
        body: JSON.stringify({ versionId: 'a0000000-0000-4000-8000-000000000001' }),
        method: 'POST',
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
