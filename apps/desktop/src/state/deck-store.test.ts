import { describe, expect, it } from 'vitest'

import type { StoredDeck } from '@ark/contracts'

import { selectHasDeck, selectIsDirty, useDeckStore } from './deck-store.ts'

const html = '<!DOCTYPE html><html><head><title>Deck</title></head><body></body></html>'

const deck: StoredDeck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  html,
  title: 'Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  documentRevision: 1,
  origin: 'authored',
  filePath: '/tmp/Deck.ark',
}

describe('useDeckStore', () => {
  it('starts empty and loading', () => {
    useDeckStore.getState().reset()
    const state = useDeckStore.getState()
    expect(state.deckId).toBeNull()
    expect(state.html).toBe('')
    expect(state.isLoading).toBe(true)
    expect(selectHasDeck(state)).toBe(false)
    expect(selectIsDirty(state)).toBe(false)
  })

  it('setActiveDeck adopts the document and upserts the summary list', () => {
    useDeckStore.getState().reset()
    useDeckStore.getState().setActiveDeck(deck)

    const state = useDeckStore.getState()
    expect(state.deckId).toBe(deck.id)
    expect(state.deckTitle).toBe('Deck')
    expect(state.filePath).toBe(deck.filePath)
    expect(state.origin).toBe('authored')
    expect(state.html).toBe(html)
    expect(state.savedHtml).toBe(html)
    expect(state.documentRevision).toBe(1)
    expect(state.decks).toEqual([
      {
        id: deck.id,
        title: deck.title,
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        documentRevision: deck.documentRevision,
        filePath: deck.filePath,
      },
    ])
    expect(selectHasDeck(state)).toBe(true)
    expect(selectIsDirty(state)).toBe(false)
  })

  it('clearActiveDeck drops the open document and keeps the list', () => {
    useDeckStore.getState().reset()
    useDeckStore.getState().setActiveDeck(deck)
    useDeckStore.getState().clearActiveDeck()

    const state = useDeckStore.getState()
    expect(state.deckId).toBeNull()
    expect(state.html).toBe('')
    expect(state.decks).toHaveLength(1)
  })

  it('applySavedDeck updates metadata without replacing optimistic html', () => {
    useDeckStore.getState().reset()
    useDeckStore.getState().setActiveDeck(deck)
    useDeckStore.getState().setHtml(`${html}<!-- dirty -->`)
    useDeckStore.getState().applySavedDeck({
      ...deck,
      html: `${html}<!-- saved -->`,
      title: 'Saved',
      documentRevision: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    const state = useDeckStore.getState()
    expect(state.html).toBe(`${html}<!-- dirty -->`)
    expect(state.savedHtml).toBe(`${html}<!-- saved -->`)
    expect(state.deckTitle).toBe('Saved')
    expect(state.documentRevision).toBe(2)
    expect(selectIsDirty(state)).toBe(true)
  })

  it('applyPatchedDeck replaces html and returns the suggested slide', () => {
    useDeckStore.getState().reset()
    useDeckStore.getState().setActiveDeck(deck)
    const suggested = useDeckStore.getState().applyPatchedDeck({
      deck: { ...deck, html: `${html}<p>patched</p>`, documentRevision: 2, origin: 'authored' },
      patch: {
        appliedCount: 1,
        changedSlideIndexes: [0],
        changedElementIds: [],
        summary: 'patched',
        suggestedActiveSlideIndex: 0,
      },
    })

    expect(suggested).toBe(0)
    expect(useDeckStore.getState().html).toContain('patched')
    expect(useDeckStore.getState().savedHtml).toContain('patched')
    expect(useDeckStore.getState().documentRevision).toBe(2)
  })

  it('setSaving and setPatching accept functional updates', () => {
    useDeckStore.getState().reset()
    useDeckStore.getState().setSaving(true)
    useDeckStore.getState().setSaving((current) => !current)
    useDeckStore.getState().setPatching(true)
    useDeckStore.getState().setPatching((current) => current && false)

    expect(useDeckStore.getState().isSaving).toBe(false)
    expect(useDeckStore.getState().isPatching).toBe(false)
  })
})
