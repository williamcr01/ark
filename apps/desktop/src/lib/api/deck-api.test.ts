import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiResponseError } from '@ark/contracts'

import {
  createDeck,
  fetchDeck,
  importPptx,
  listDecks,
  listDocumentHistory,
  moveWorkspace,
  renameDeck,
  restoreDocumentHistory,
  saveWorkspaceAs,
  updateDeck,
} from './deck-api'

const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  html: '<!DOCTYPE html><html><head><title>Deck</title></head><body></body></html>',
  title: 'Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  documentRevision: 1,
  origin: 'authored' as const,
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

const validation = {
  valid: true,
  slideCount: 1,
  scripts: [],
  forms: 0,
  iframes: 0,
  externalUrls: [],
  malformedSlides: [],
  runtimeMarkers: {},
  issues: [],
}

const historySummaries = [
  {
    revision: 1,
    source: 'create' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
    byteSize: 120,
  },
  {
    revision: 2,
    source: 'editor' as const,
    createdAt: '2026-09-01T00:01:00.000Z',
    byteSize: 240,
  },
]

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

  it('imports a PowerPoint file into a new deck', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(importPptx({ filename: 'board.pptx', bytes: 'AAAA' })).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/decks/import-pptx',
      expect.objectContaining({
        body: JSON.stringify({ filename: 'board.pptx', bytes: 'AAAA' }),
        method: 'POST',
      }),
    )
  })

  it('updates the current document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(updateDeck(deck.id, deck.html, deck.documentRevision)).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({
        body: JSON.stringify({ html: deck.html, expectedDocumentRevision: deck.documentRevision }),
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

  it('sends the overwrite flag only when Save As or Move should replace', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck }))

    vi.stubGlobal('fetch', fetchMock)

    await expect(saveWorkspaceAs(deck.id, '/tmp/Target.ark', true)).resolves.toEqual(deck)
    await expect(moveWorkspace(deck.id, '/tmp/Target.ark')).resolves.toEqual(deck)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/decks/${deck.id}/save-as`,
      expect.objectContaining({
        body: JSON.stringify({ path: '/tmp/Target.ark', overwrite: true }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/decks/${deck.id}/move`,
      expect.objectContaining({
        body: JSON.stringify({ path: '/tmp/Target.ark', overwrite: false }),
        method: 'POST',
      }),
    )
  })

  it('lists document history summaries without HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        history: historySummaries.map((row) => ({
          ...row,
          html: '<section class="slide">secret</section>',
        })),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const history = await listDocumentHistory(deck.id)

    expect(fetchMock).toHaveBeenCalledWith(`/api/decks/${deck.id}/history`)
    expect(history).toEqual(historySummaries)
    for (const row of history) {
      expect(row).not.toHaveProperty('html')
    }
  })

  it('restores a history revision with the conflict token', async () => {
    const restored = { ...deck, documentRevision: 3, html: '<html>restored</html>' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deck: restored, validation }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      restoreDocumentHistory(deck.id, { revision: 1, expectedDocumentRevision: 2 }),
    ).resolves.toEqual(restored)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}/history/restore`,
      expect.objectContaining({
        body: JSON.stringify({ revision: 1, expectedDocumentRevision: 2 }),
        method: 'POST',
      }),
    )
  })

  it('surfaces a 409 document conflict on restore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'The document changed.',
          code: 'document_conflict',
          currentDocumentRevision: 4,
        },
        { ok: false, status: 409 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const conflict = restoreDocumentHistory(deck.id, {
      revision: 1,
      expectedDocumentRevision: 2,
    })
    await expect(conflict).rejects.toBeInstanceOf(ApiResponseError)
    await expect(conflict).rejects.toMatchObject({
      code: 'document_conflict',
      message: 'The document changed.',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}/history/restore`,
      expect.objectContaining({
        body: JSON.stringify({ revision: 1, expectedDocumentRevision: 2 }),
        method: 'POST',
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
