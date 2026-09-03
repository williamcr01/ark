import { create } from 'zustand'

import type { DeckOrigin, DeckPatchResponse, DeckSummary, StoredDeck } from '@ark/contracts'

import { resolveUpdate, type StateUpdate } from './apply-update.ts'

export type DeckStoreState = {
  deckId: string | null
  deckTitle: string
  filePath: string | null
  origin: DeckOrigin | null
  html: string
  savedHtml: string
  documentRevision: number | null
  isLoading: boolean
  isSaving: boolean
  isPatching: boolean
  saveError: string
  decks: DeckSummary[]
}

type PatchedDeckResult = Pick<DeckPatchResponse, 'deck' | 'patch'>

export type DeckStoreActions = {
  applyPatchedDeck: (patchResult: PatchedDeckResult) => number | undefined
  applySavedDeck: (deck: StoredDeck, options?: { replaceHtml?: boolean }) => void
  clearActiveDeck: () => void
  reset: () => void
  setActiveDeck: (deck: StoredDeck) => void
  setDeckTitle: (title: string) => void
  setDecks: (update: StateUpdate<DeckSummary[]>) => void
  setHtml: (html: string) => void
  setLoading: (update: StateUpdate<boolean>) => void
  setPatching: (update: StateUpdate<boolean>) => void
  setSaveError: (saveError: string) => void
  setSaving: (update: StateUpdate<boolean>) => void
  upsertDeck: (deck: StoredDeck) => void
}

export type DeckStore = DeckStoreState & DeckStoreActions

const toDeckSummary = (deck: StoredDeck): DeckSummary => ({
  id: deck.id,
  title: deck.title,
  createdAt: deck.createdAt,
  updatedAt: deck.updatedAt,
  documentRevision: deck.documentRevision,
  filePath: deck.filePath,
})

const sortDeckSummaries = (decks: DeckSummary[]) =>
  decks.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))

export const upsertDeckSummary = (decks: DeckSummary[], deck: StoredDeck) =>
  sortDeckSummaries([
    toDeckSummary(deck),
    ...decks.filter((existingDeck) => existingDeck.id !== deck.id),
  ])

const clearedActiveDeck: Pick<
  DeckStoreState,
  'deckId' | 'deckTitle' | 'filePath' | 'origin' | 'html' | 'savedHtml' | 'documentRevision'
> = {
  deckId: null,
  deckTitle: '',
  filePath: null,
  origin: null,
  html: '',
  savedHtml: '',
  documentRevision: null,
}

const initialState: DeckStoreState = {
  ...clearedActiveDeck,
  isLoading: true,
  isSaving: false,
  isPatching: false,
  saveError: '',
  decks: [],
}

export const useDeckStore = create<DeckStore>()((set) => ({
  ...initialState,
  applyPatchedDeck: (patchResult) => {
    const { deck, patch } = patchResult
    set((state) => ({
      html: deck.html,
      savedHtml: deck.html,
      origin: deck.origin,
      documentRevision: deck.documentRevision,
      decks: upsertDeckSummary(state.decks, deck),
    }))
    return patch.suggestedActiveSlideIndex
  },
  applySavedDeck: (deck, options = {}) => {
    set((state) => ({
      deckId: deck.id,
      deckTitle: deck.title,
      filePath: deck.filePath,
      origin: deck.origin,
      documentRevision: deck.documentRevision,
      savedHtml: deck.html,
      html: options.replaceHtml ? deck.html : state.html,
      decks: upsertDeckSummary(state.decks, deck),
    }))
  },
  clearActiveDeck: () => {
    set(clearedActiveDeck)
  },
  reset: () => {
    set(initialState)
  },
  setActiveDeck: (deck) => {
    set((state) => ({
      deckId: deck.id,
      deckTitle: deck.title,
      filePath: deck.filePath,
      origin: deck.origin,
      html: deck.html,
      savedHtml: deck.html,
      documentRevision: deck.documentRevision,
      decks: upsertDeckSummary(state.decks, deck),
    }))
  },
  setDeckTitle: (deckTitle) => {
    set({ deckTitle })
  },
  setDecks: (update) => {
    set((state) => ({ decks: resolveUpdate(state.decks, update) }))
  },
  setHtml: (html) => {
    set({ html })
  },
  setLoading: (update) => {
    set((state) => ({ isLoading: resolveUpdate(state.isLoading, update) }))
  },
  setPatching: (update) => {
    set((state) => ({ isPatching: resolveUpdate(state.isPatching, update) }))
  },
  setSaveError: (saveError) => {
    set({ saveError })
  },
  setSaving: (update) => {
    set((state) => ({ isSaving: resolveUpdate(state.isSaving, update) }))
  },
  upsertDeck: (deck) => {
    set((state) => ({ decks: upsertDeckSummary(state.decks, deck) }))
  },
}))

export const selectHasDeck = (state: DeckStoreState) => state.html.length > 0

export const selectIsDirty = (state: DeckStoreState) =>
  state.html.length > 0 && state.html !== state.savedHtml

export const useDeckHtml = () => useDeckStore((state) => state.html)
export const useDeckId = () => useDeckStore((state) => state.deckId)
