import type { DeckPatchOperation } from '@ark/deck/patch/patch-request.ts'
import {
  deckListResponseSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  fetchApiJsonOrThrow,
  type DeckOrigin,
  type DeckPatchRequest,
  type DeckPatchResponse,
  type DeckSummary,
  type StoredDeck,
} from '@ark/contracts'

export type { DeckOrigin, DeckPatchResponse, DeckSummary, StoredDeck }

export type PatchDeckResponse = Pick<DeckPatchResponse, 'deck' | 'patch'>

export type PatchDeckOptions = Pick<
  DeckPatchRequest,
  'activeSlideIndex' | 'expectedDocumentRevision'
> & {
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

export async function listDecks() {
  const response = await fetch('/api/decks')
  return readDeckListResponse(response)
}

export async function fetchDeck(id: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`)
  return readDeckResponse(response)
}

export async function createDeck(html: string, origin?: DeckOrigin) {
  const response = await fetch('/api/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(origin ? { html, origin } : { html }),
  })

  return readDeckResponse(response)
}

export async function updateDeck(id: string, html: string, expectedDocumentRevision: number) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, expectedDocumentRevision }),
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
  const { operations, activeSlideIndex, expectedDocumentRevision } = options
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}/patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations,
      activeSlideIndex,
      expectedDocumentRevision,
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

export async function exportDeckHtml(id: string, sanitized = false) {
  const query = sanitized ? '?sanitized=true' : ''
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}/export${query}`)
  if (!response.ok) throw new Error('Could not export the deck.')
  return response.text()
}

async function postWorkspace(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readDeckResponse(response)
}

export const openWorkspace = (path: string) => postWorkspace('/api/workspaces/open', { path })
export const locateWorkspace = (id: string, path: string) =>
  postWorkspace(`/api/workspaces/${encodeURIComponent(id)}/locate`, { path })
export async function removeRecentWorkspace(id: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}/recent`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 204) throw new Error('Could not remove recent workspace.')
}
export const saveWorkspaceAs = (id: string, path: string, overwrite = false) =>
  postWorkspace(`/api/decks/${encodeURIComponent(id)}/save-as`, { path, overwrite })
export const moveWorkspace = (id: string, path: string, overwrite = false) =>
  postWorkspace(`/api/decks/${encodeURIComponent(id)}/move`, { path, overwrite })
export const duplicateWorkspace = (
  id: string,
  mode: 'presentation' | 'complete',
  path?: string,
  overwrite = false,
) => postWorkspace(`/api/decks/${encodeURIComponent(id)}/duplicate`, { mode, path, overwrite })
