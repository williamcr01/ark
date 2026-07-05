import type { DeckPatchOperation, DeckPatchRequest } from '../../shared/deck-patch.ts'

export type DeckVersionSource = 'manual' | 'agent' | 'upload' | 'repair' | 'rollback'

export type DeckValidationStatus = 'unknown' | 'valid' | 'invalid'

export type StoredDeck = {
  id: string
  html: string
  title: string
  createdAt: string
  updatedAt: string
  activeVersionId?: string | null
  versionNumber?: number | null
}

export type DeckSummary = Omit<StoredDeck, 'html'>

export type DeckVersionSummary = {
  id: string
  deckId: string
  versionNumber: number
  title: string
  source: DeckVersionSource
  summary: string | null
  validationStatus: DeckValidationStatus
  createdAt: string
  isActive: boolean
}

export type DeckVersionDetail = DeckVersionSummary & {
  html: string
}

export type DeckVersionOptions = {
  source?: DeckVersionSource
  summary?: string | null
  modelProvider?: string | null
  modelName?: string | null
}

export type DeckPatchResponse = {
  deck: StoredDeck
  patch: {
    appliedCount: number
    changedSlideIndexes: number[]
    changedElementIds: string[]
    summary: string
    suggestedActiveSlideIndex?: number
  }
}

type DeckPatchApiResponse = DeckPatchResponse & {
  error?: string
  operationIndex?: number
}

type DeckResponse = {
  deck?: StoredDeck
  error?: string
}

type DeckListResponse = {
  decks?: DeckSummary[]
  error?: string
}

type DeckVersionListResponse = {
  versions?: DeckVersionSummary[]
  error?: string
}

type DeckVersionResponse = {
  version?: DeckVersionDetail
  error?: string
}

async function readDeckResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckResponse

  if (!response.ok || !data.deck) {
    throw new Error(data.error ?? 'Could not load the deck.')
  }

  return data.deck
}

async function readDeckListResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckListResponse

  if (!response.ok || !Array.isArray(data.decks)) {
    throw new Error(data.error ?? 'Could not load decks.')
  }

  return data.decks
}

async function readVersionListResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckVersionListResponse

  if (!response.ok || !Array.isArray(data.versions)) {
    throw new Error(data.error ?? 'Could not load deck versions.')
  }

  return data.versions
}

async function readVersionResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckVersionResponse

  if (!response.ok || !data.version) {
    throw new Error(data.error ?? 'Could not load the deck version.')
  }

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

export type PatchDeckOptions = DeckVersionOptions &
  Pick<DeckPatchRequest, 'activeSlideIndex'> & {
    operations: DeckPatchOperation[]
  }

async function readPatchResponse(response: Response): Promise<DeckPatchResponse> {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckPatchApiResponse

  if (!response.ok || !data.deck || !data.patch) {
    const operationHint =
      typeof data.operationIndex === 'number' ? ` (operation ${data.operationIndex})` : ''
    throw new Error((data.error ?? 'Could not patch the deck.') + operationHint)
  }

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

  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckResponse

  throw new Error(data.error ?? 'Could not delete the deck.')
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
