import type { Response } from 'express'
import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import type { AssetStore } from '@ark/storage/records/asset-record.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'
import { WorkspaceDocumentConflictError } from '@ark/storage/stores/workspace-store.ts'

export type DecksRouterDeps = {
  deckStore: DeckStore
  assetStore: AssetStore
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  onEditorPatchPersisted?: (deckId: string, documentRevision: number) => void
}

export function notifyDocumentPersisted(
  deps: DecksRouterDeps,
  deckId: string,
  documentRevision: number,
) {
  deps.onDocumentPersisted?.(deckId, documentRevision)
}

export function sendDeckWriteError(response: Response, error: unknown) {
  if (error instanceof WorkspaceDocumentConflictError) {
    response.status(409).json({
      error: error.message,
      code: error.code,
      currentDocumentRevision: error.currentDocumentRevision,
    })
    return
  }
  sendApiError(response, 500, getApiErrorFromUnknown(error))
}
