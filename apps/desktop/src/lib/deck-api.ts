import type { DeckPatchOperation } from '@ark/deck-core/deck-patch.ts'
import {
  deckListResponseSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  deckVersionListResponseSchema,
  deckVersionResponseSchema,
  fetchApiJsonOrThrow,
  type DeckManualVersionProvenance,
  type DeckPatchRequest,
  type DeckPatchResponse,
  type DeckSummary,
  type DeckVersionDetail,
  type DeckVersionDiff,
  type DeckVersionOptions,
  type DeckVersionProvenance,
  type DeckVersionSource,
  type DeckVersionSummary,
  type StoredDeck,
} from '@ark/contracts'

export type {
  DeckManualVersionProvenance,
  DeckPatchResponse,
  DeckSummary,
  DeckVersionDetail,
  DeckVersionDiff,
  DeckVersionOptions,
  DeckVersionProvenance,
  DeckVersionSource,
  DeckVersionSummary,
  StoredDeck,
}

export type PatchDeckResponse = Pick<DeckPatchResponse, 'deck' | 'patch'>

export type PatchDeckOptions = DeckVersionOptions &
  Pick<DeckPatchRequest, 'activeSlideIndex'> & {
    operations: DeckPatchOperation[]
  }

async function readDeckResponse(response: Response) {
  const data = await fetchApiJsonOrThrow(response, deckResponseSchema, {
    fallbackMessage: 'Could not load the deck.',
  })
  return data.deck
}

async function readDeckListResponse(response: Response) {
  const data = await fetchApiJsonOrThrow(response, deckListResponseSchema, {
    fallbackMessage: 'Could not load decks.',
  })
  return data.decks
}

async function readVersionListResponse(response: Response) {
  const data = await fetchApiJsonOrThrow(response, deckVersionListResponseSchema, {
    fallbackMessage: 'Could not load deck versions.',
  })
  return data.versions
}

async function readVersionResponse(response: Response) {
  const data = await fetchApiJsonOrThrow(response, deckVersionResponseSchema, {
    fallbackMessage: 'Could not load the deck version.',
  })
  return data.version
}

export async function listDecks() {
  const response = await fetch('/api/decks')
  return readDeckListResponse(response)
}

export async function fetchDeck(id: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`)
  return readDeckResponse(response)
}

export async function createDeck(html: string, options: DeckVersionOptions = {}) {
  const response = await fetch('/api/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, ...options }),
  })

  return readDeckResponse(response)
}

export async function updateDeck(id: string, html: string, options: DeckVersionOptions = {}) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, ...options }),
  })

  return readDeckResponse(response)
}

export async function renameDeck(id: string, title: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })

  return readDeckResponse(response)
}

async function readPatchResponse(response: Response): Promise<PatchDeckResponse> {
  const data = await fetchApiJsonOrThrow(response, deckPatchResponseSchema, {
    fallbackMessage: 'Could not patch the deck.',
  })
  return { deck: data.deck, patch: data.patch }
}

export async function patchDeck(id: string, options: PatchDeckOptions) {
  const { operations, activeSlideIndex, ...versionOptions } = options
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}/patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations,
      activeSlideIndex,
      ...versionOptions,
    }),
  })

  return readPatchResponse(response)
}

export async function deleteDeck(id: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  if (response.status === 204) {
    return
  }

  await readDeckResponse(response)
}

export async function listDeckVersions(deckId: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/versions`)
  return readVersionListResponse(response)
}

export async function fetchDeckVersion(deckId: string, versionId: string) {
  const response = await fetch(
    `/api/decks/${encodeURIComponent(deckId)}/versions/${encodeURIComponent(versionId)}`,
  )
  return readVersionResponse(response)
}

export async function rollbackDeck(deckId: string, versionId: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  })

  return readDeckResponse(response)
}
