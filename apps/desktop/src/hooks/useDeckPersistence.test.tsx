import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiResponseError } from '@ark/contracts'

import { useDeckPersistence } from './useDeckPersistence'

const html = '<!DOCTYPE html><html><head><title>Deck</title></head><body></body></html>'
const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  html,
  title: 'Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  documentRevision: 1,
  origin: 'authored' as const,
  filePath: '/tmp/Deck.ark',
}
const summary = {
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

describe('useDeckPersistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads a workspace from the route id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input)
      if (url === '/api/decks') return jsonResponse({ decks: [summary] })
      if (url === `/api/decks/${deck.id}`) return jsonResponse({ deck })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence(deck.id))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.deckId).toBe(deck.id)
    expect(result.current.filePath).toBe(deck.filePath)
    expect(result.current.documentRevision).toBe(1)
    expect(result.current.html).toBe(html)
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('/history'))).toBe(true)
  })

  it('does not create a workspace on the new route until asked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input) === '/api/decks' && init?.method === 'POST') {
        return jsonResponse({ deck }, { status: 201 })
      }
      if (String(input) === '/api/decks') return jsonResponse({ decks: [] })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence(null))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.deckId).toBeNull()
    expect(result.current.hasDeck).toBe(false)
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/decks',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates a blank workspace once when the first prompt needs one', async () => {
    const blankDeck = { ...deck, origin: 'blank' as const }
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input) === '/api/decks' && init?.method === 'POST') {
        return jsonResponse({ deck: blankDeck }, { status: 201 })
      }
      if (String(input) === '/api/decks') return jsonResponse({ decks: [] })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence(null))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let firstId: string | null = null
    let secondId: string | null = null
    await act(async () => {
      firstId = await result.current.ensureBlankDeck()
      secondId = await result.current.ensureBlankDeck()
    })

    expect(firstId).toBe(blankDeck.id)
    expect(secondId).toBe(blankDeck.id)
    expect(result.current.origin).toBe('blank')
    expect(result.current.deckId).toBe(blankDeck.id)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('saves into the open workspace and adopts its next document revision and path', async () => {
    const updated = {
      ...deck,
      html: html.replace('</body>', '<p>Saved</p></body>'),
      updatedAt: '2026-01-02T00:00:00.000Z',
      documentRevision: 2,
      filePath: '/tmp/Board plan.ark',
    }
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/decks') return jsonResponse({ decks: [summary] })
      if (url === `/api/decks/${deck.id}` && init?.method === 'PUT') {
        return jsonResponse({ deck: updated })
      }
      if (url === `/api/decks/${deck.id}`) return jsonResponse({ deck })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeckPersistence(deck.id))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.persistHtml(updated.html)
    })

    expect(result.current.html).toBe(updated.html)
    expect(result.current.documentRevision).toBe(2)
    expect(result.current.filePath).toBe('/tmp/Board plan.ark')
    expect(result.current.isDirty).toBe(false)
  })

  it('save-as adopts the selected workspace path', async () => {
    const savedAs = { ...deck, filePath: '/tmp/Deck Copy.ark' }
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/decks') return jsonResponse({ decks: [summary] })
      if (url === `/api/decks/${deck.id}/save-as` && init?.method === 'POST') {
        return jsonResponse({ deck: savedAs })
      }
      if (url === `/api/decks/${deck.id}`) return jsonResponse({ deck })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeckPersistence(deck.id))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.saveAs(savedAs.filePath)
    })

    expect(result.current.filePath).toBe(savedAs.filePath)
  })

  it('adopts the renamed workspace path, document, and revision', async () => {
    const renamedHtml = html.replace('<title>Deck</title>', '<title>Board plan</title>')
    const renamed = {
      ...deck,
      title: 'Board plan',
      html: renamedHtml,
      filePath: '/tmp/Board plan.ark',
      documentRevision: 2,
    }
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/decks') return jsonResponse({ decks: [summary] })
      if (url === `/api/decks/${deck.id}` && init?.method === 'PATCH') {
        return jsonResponse({ deck: renamed })
      }
      if (url === `/api/decks/${deck.id}`) return jsonResponse({ deck })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeckPersistence(deck.id))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.renameActiveDeck('Board plan')
    })

    expect(result.current.deckTitle).toBe('Board plan')
    expect(result.current.filePath).toBe('/tmp/Board plan.ark')
    expect(result.current.html).toBe(renamedHtml)
    expect(result.current.documentRevision).toBe(2)
  })

  it('restores a history revision and adopts the returned deck', async () => {
    const restored = {
      ...deck,
      html: html.replace('Deck', 'Earlier'),
      documentRevision: 3,
      updatedAt: '2026-01-03T00:00:00.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/decks') return jsonResponse({ decks: [summary] })
      if (url === `/api/decks/${deck.id}/history/restore` && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          revision: 1,
          expectedDocumentRevision: 1,
        })
        return jsonResponse({
          deck: restored,
          validation: {
            valid: true,
            slideCount: 1,
            scripts: [],
            forms: 0,
            iframes: 0,
            externalUrls: [],
            malformedSlides: [],
            runtimeMarkers: {},
            issues: [],
          },
        })
      }
      if (url === `/api/decks/${deck.id}`) return jsonResponse({ deck })
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeckPersistence(deck.id))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.restoreFromHistory(1)
    })

    expect(result.current.html).toBe(restored.html)
    expect(result.current.documentRevision).toBe(3)
  })

  it('refreshes the open deck when restore hits a document conflict', async () => {
    const current = {
      ...deck,
      html: html.replace('Deck', 'Live'),
      documentRevision: 4,
    }
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/decks') return jsonResponse({ decks: [summary] })
      if (url === `/api/decks/${deck.id}/history/restore` && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          revision: 1,
          expectedDocumentRevision: 1,
        })
        return jsonResponse(
          {
            error: 'The document changed.',
            code: 'document_conflict',
            currentDocumentRevision: 4,
          },
          { ok: false, status: 409 },
        )
      }
      if (url === `/api/decks/${deck.id}`) {
        const deckGets = fetchMock.mock.calls.filter((call) => String(call[0]) === url).length
        return jsonResponse({ deck: deckGets > 1 ? current : deck })
      }
      return jsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useDeckPersistence(deck.id))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await expect(result.current.restoreFromHistory(1)).rejects.toBeInstanceOf(ApiResponseError)
    })

    await waitFor(() => expect(result.current.documentRevision).toBe(4))
    expect(result.current.html).toBe(current.html)
  })
})
