import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  })

  it('creates a real workspace immediately on the new route', async () => {
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
    expect(result.current.deckId).toBe(deck.id)
    expect(result.current.hasDeck).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/decks',
      expect.objectContaining({ method: 'POST' }),
    )
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
})
