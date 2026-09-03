import { Router, type Request, type Response } from 'express'
import {
  restoreDocumentHistoryRequestSchema,
  isValidDeckId,
  parseRequestBody,
} from '@ark/contracts'
import {
  WorkspaceDocumentConflictError,
  WorkspaceDocumentHistoryNotFoundError,
  type WorkspaceStore,
} from '@ark/storage/stores/workspace-store.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError, sendDeckValidationError } from './shared.ts'
import { toDeck, workspaceActionError } from './workspaces-shared.ts'

export function registerWorkspaceHistoryRoutes(
  router: Router,
  workspaces: WorkspaceStore,
  notifyDocumentPersisted: (deckId: string, documentRevision: number) => void,
) {
  router.get('/api/decks/:id/history', async (request: Request<{ id: string }>, response) => {
    if (!isValidDeckId(request.params.id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }
    try {
      const history = await workspaces.listDocumentHistory(request.params.id)
      if (!history) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }
      response.json({ history })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.post(
    '/api/decks/:id/history/restore',
    async (request: Request<{ id: string }>, response: Response) => {
      const parsed = parseRequestBody(restoreDocumentHistoryRequestSchema, request.body)
      if (!isValidDeckId(request.params.id) || !parsed.ok) {
        response.status(400).json({ error: parsed.ok ? 'Invalid deck id.' : parsed.error })
        return
      }
      try {
        const html = await workspaces.readDocumentHistoryHtml(
          request.params.id,
          parsed.data.revision,
        )
        if (html === null) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }
        const validation = validateDeckHtmlOnServer(html, { logger: getRequestLogger(request) })
        if (!validation.valid) {
          sendDeckValidationError(response, validation, request)
          return
        }

        const workspace = await workspaces.restoreDocument(
          request.params.id,
          parsed.data.revision,
          parsed.data.expectedDocumentRevision,
        )
        if (!workspace) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }
        notifyDocumentPersisted(workspace.id, workspace.documentRevision)
        response.json({ deck: toDeck(workspace), validation })
      } catch (error) {
        if (error instanceof WorkspaceDocumentConflictError) {
          response.status(409).json({
            error: error.message,
            code: error.code,
            currentDocumentRevision: error.currentDocumentRevision,
          })
          return
        }
        if (error instanceof WorkspaceDocumentHistoryNotFoundError) {
          response.status(404).json({ error: error.message })
          return
        }
        const { status, payload } = workspaceActionError(error)
        sendApiError(response, status, payload)
      }
    },
  )
}
