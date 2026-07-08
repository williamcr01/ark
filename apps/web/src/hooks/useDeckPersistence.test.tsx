import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTestLocalStorage, installTestLocalStorage } from '@/test/storage'
import type { StoredDeck } from '@/lib/deck-api'

import { useDeckPersistence } from './useDeckPersistence'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Deck</title></head>
<body><section class="slide">One</section></body>
</html>`

const updatedHtml = sampleHtml.replace('One', 'Two')

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
const secondDeckId = 'd15f3a35-7ee4-47dd-9c7e-2f8b4eb1fd71'

const deck = {
  id: deckId,
  html: sampleHtml,
  title: 'Test Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  activeVersionId: 'a0000000-0000-4000-8000-000000000001',
  versionNumber: 1,
}

const secondDeck = {
  id: secondDeckId,
  html: sampleHtml.replace('Test Deck', 'Roadmap'),
  title: 'Roadmap',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  activeVersionId: 'b0000000-0000-4000-8000-000000000001',
  versionNumber: 1,
}

const toSummary = (storedDeck: typeof deck) => ({
  id: storedDeck.id,
  title: storedDeck.title,
  createdAt: storedDeck.createdAt,
  updatedAt: storedDeck.updatedAt,
  activeVersionId: storedDeck.activeVersionId ?? null,
  versionNumber: storedDeck.versionNumber ?? null,
})

const versionsResponse = (deckId: string) =>
  jsonResponse({
    versions: [
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        deckId,
        versionNumber: 1,
        title: 'Test Deck',
        source: 'manual',
        summary: null,
        validationStatus: 'valid',
        runtimeManifest: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: true,
      },
    ],
  })

const jsonResponse = (body: unknown, options: { ok?: boolean; status?: number } = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => body,
})

const validValidation = {
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

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/decks')
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/decks/${deck.id}`)
    expect(result.current.deckId).toBe(deck.id)
    expect(result.current.deckTitle).toBe('Test Deck')
    expect(result.current.decks).toEqual([toSummary(deck)])
    expect(result.current.html).toBe(sampleHtml)
    expect(result.current.hasDeck).toBe(true)
    expect(result.current.isDirty).toBe(false)
  })

  it('clears a stale active deck id after refresh', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ decks: [] }))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.hasDeck).toBe(false)
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBeNull()
  })

  it('persists new HTML and marks the deck as saved', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [] }))
      .mockResolvedValueOnce(jsonResponse({ deck }, { status: 201 }))
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.persistHtml(sampleHtml)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/decks',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(result.current.html).toBe(sampleHtml)
    expect(result.current.decks).toEqual([toSummary(deck)])
    expect(result.current.isDirty).toBe(false)
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBe(deck.id)
  })

  it('returns the saved deck from persistHtml', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [] }))
      .mockResolvedValueOnce(jsonResponse({ deck }, { status: 201 }))
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let savedDeck: StoredDeck | undefined

    await act(async () => {
      savedDeck = await result.current.persistHtml(sampleHtml)
    })

    expect(savedDeck).toEqual(deck)
  })

  it('updates an existing deck and tracks dirty state until save completes', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                jsonResponse({
                  deck: { ...deck, html: updatedHtml, updatedAt: '2026-01-02T00:00:00.000Z' },
                }),
              )
            }, 20)
          }),
      )
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let persistPromise: Promise<StoredDeck | undefined> | undefined

    act(() => {
      persistPromise = result.current.persistHtml(updatedHtml)
    })

    expect(result.current.html).toBe(updatedHtml)
    expect(result.current.isDirty).toBe(true)
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      await persistPromise
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/decks/${deck.id}`,
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(result.current.isDirty).toBe(false)
    expect(result.current.isSaving).toBe(false)
  })

  it('starts a new deck without deleting the previous saved deck', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.startNewDeck()
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.hasDeck).toBe(false)
    expect(result.current.decks).toEqual([toSummary(deck)])
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBeNull()
  })

  it('selects another saved deck', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(secondDeck), toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck: secondDeck }))
      .mockResolvedValueOnce(versionsResponse(secondDeck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.selectDeck(secondDeck.id)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/decks/${secondDeck.id}`)
    expect(result.current.deckId).toBe(secondDeck.id)
    expect(result.current.deckTitle).toBe('Roadmap')
    expect(result.current.html).toBe(secondDeck.html)
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBe(secondDeck.id)
  })

  it('renames the active deck metadata', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const renamedDeck = {
      ...deck,
      title: 'Board plan',
      updatedAt: '2026-01-03T00:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockResolvedValueOnce(jsonResponse({ deck: renamedDeck }))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.renameActiveDeck('Board plan')
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({
        body: JSON.stringify({ title: 'Board plan' }),
        method: 'PATCH',
      }),
    )
    expect(result.current.deckTitle).toBe('Board plan')
    expect(result.current.html).toBe(sampleHtml)
    expect(result.current.decks.at(0)).toEqual(toSummary(renamedDeck))
  })

  it('deletes the active deck explicitly', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockResolvedValueOnce(jsonResponse({}, { status: 204 }))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.deleteActiveDeck()
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/decks/${deck.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.current.hasDeck).toBe(false)
    expect(result.current.decks).toEqual([])
    expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBeNull()
  })

  it('ignores stale version inspect responses when selection changes quickly', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const versionA = {
      id: 'a0000000-0000-4000-8000-000000000001',
      deckId: deck.id,
      versionNumber: 1,
      title: 'Test Deck',
      source: 'manual' as const,
      summary: null,
      validationStatus: 'valid' as const,
      runtimeManifest: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      isActive: false,
      html: sampleHtml,
    }
    const versionB = {
      ...versionA,
      id: 'b0000000-0000-4000-8000-000000000001',
      versionNumber: 2,
      html: updatedHtml,
      isActive: true,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(jsonResponse({ version: versionA }))
            }, 30)
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ version: versionB }))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let inspectA: Promise<unknown>
    let inspectB: Promise<unknown>

    act(() => {
      inspectA = result.current.inspectVersion(versionA.id)
      inspectB = result.current.inspectVersion(versionB.id)
    })

    await act(async () => {
      await inspectB
    })

    expect(result.current.previewVersion).toEqual(versionB)

    await act(async () => {
      await inspectA
    })

    expect(result.current.previewVersion).toEqual(versionB)
  })

  it('patches the active deck without toggling the general save state', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const patchedHtml = sampleHtml.replace('One', 'Patched')
    const patchedDeck = {
      ...deck,
      html: patchedHtml,
      updatedAt: '2026-01-02T00:00:00.000Z',
      versionNumber: 2,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockResolvedValueOnce(
        jsonResponse({
          deck: patchedDeck,
          validation: validValidation,
          patch: {
            appliedCount: 1,
            changedSlideIndexes: [0],
            changedElementIds: ['transient-el-0-0'],
            summary: 'Edited text in preview',
            suggestedActiveSlideIndex: 0,
          },
        }),
      )
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let patchPromise: Promise<unknown> | undefined

    act(() => {
      patchPromise = result.current.patchDeckOperations(
        [{ op: 'replace_text', elementId: 'transient-el-0-0', slideIndex: 0, text: 'Patched' }],
        0,
        { summary: 'Edited text in preview' },
      )
    })

    expect(result.current.isPatching).toBe(true)
    expect(result.current.isSaving).toBe(false)

    await act(async () => {
      await patchPromise
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deck.id}/patch`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.current.html).toBe(patchedHtml)
    expect(result.current.isPatching).toBe(false)
    expect(result.current.isSaving).toBe(false)
  })

  it('forwards provenance on restoreHtmlSnapshot PUT requests', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const restoredHtml = sampleHtml.replace('One', 'Restored')
    const restoredDeck = {
      ...deck,
      html: restoredHtml,
      updatedAt: '2026-01-03T00:00:00.000Z',
      versionNumber: 3,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockResolvedValueOnce(jsonResponse({ deck: restoredDeck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.restoreHtmlSnapshot(restoredHtml, {
        summary: 'Undo: Edited text in preview',
        provenance: {
          operations: ['undo'],
          slideIndexes: [0],
          elementIds: ['el-1'],
        },
      })
    })

    const restoreCall = fetchMock.mock.calls.find(
      (call) => call[0] === `/api/decks/${deck.id}` && call[1]?.method === 'PUT',
    )
    expect(restoreCall).toBeTruthy()
    expect(JSON.parse(String(restoreCall?.[1]?.body))).toEqual({
      html: restoredHtml,
      source: 'manual',
      summary: 'Undo: Edited text in preview',
      provenance: {
        operations: ['undo'],
        slideIndexes: [0],
        elementIds: ['el-1'],
      },
    })
    expect(result.current.html).toBe(restoredHtml)
  })

  it('keeps restoreHtmlSnapshot source locked to manual when options override it', async () => {
    getTestLocalStorage().setItem('ark:active-deck-id', deck.id)

    const restoredHtml = sampleHtml.replace('One', 'Locked')
    const restoredDeck = {
      ...deck,
      html: restoredHtml,
      updatedAt: '2026-01-03T00:00:00.000Z',
      versionNumber: 3,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ decks: [toSummary(deck)] }))
      .mockResolvedValueOnce(jsonResponse({ deck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))
      .mockResolvedValueOnce(jsonResponse({ deck: restoredDeck }))
      .mockResolvedValueOnce(versionsResponse(deck.id))

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDeckPersistence())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.restoreHtmlSnapshot(restoredHtml, {
        source: 'upload',
        summary: 'Should stay manual',
        provenance: {
          operations: ['redo'],
        },
      })
    })

    const restoreCall = fetchMock.mock.calls.find(
      (call) => call[0] === `/api/decks/${deck.id}` && call[1]?.method === 'PUT',
    )
    expect(restoreCall).toBeTruthy()
    expect(JSON.parse(String(restoreCall?.[1]?.body))).toEqual({
      html: restoredHtml,
      source: 'manual',
      summary: 'Should stay manual',
      provenance: {
        operations: ['redo'],
      },
    })
  })
})
