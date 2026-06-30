import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTestLocalStorage, installTestLocalStorage } from '@/test/storage'

import { useDeckPersistence } from './useDeckPersistence'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Deck</title></head>
<body><section class="slide">One</section></body>
</html>`

const updatedHtml = sampleHtml.replace('One', 'Two')

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

const deck = {
  id: deckId,
  html: sampleHtml,
  title: 'Test Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('useDeckPersistence', () => {
  beforeEach(() => {
    installTestLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    installTestLocalStorage()
    getTestLocalStorage().clear()
  })

  it('restores the active deck after refresh', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ deck }),
      }),
    )

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.html).toBe(sampleHtml)
    expect(result.current.hasDeck).toBe(true)
    expect(result.current.isDirty).toBe(false)
  })

  it('persists new HTML and marks the deck as saved', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ deck }),
    })

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.persistHtml(sampleHtml)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/decks',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(result.current.html).toBe(sampleHtml)
    expect(result.current.isDirty).toBe(false)
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBe(deck.id)
  })

  it('updates an existing deck and tracks dirty state until save completes', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deck }),
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({
                  deck: { ...deck, html: updatedHtml, updatedAt: '2026-01-02T00:00:00.000Z' },
                }),
              })
            }, 20)
          }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let persistPromise: Promise<void> | undefined

    act(() => {
      persistPromise = result.current.persistHtml(updatedHtml)
    })

    expect(result.current.html).toBe(updatedHtml)
    expect(result.current.isDirty).toBe(true)
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      await persistPromise
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(result.current.isDirty).toBe(false)
    expect(result.current.isSaving).toBe(false)
  })

  it('clears local and server state on reset', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deck }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.resetDeck()
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.current.hasDeck).toBe(false)
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBeNull()
  })
})
