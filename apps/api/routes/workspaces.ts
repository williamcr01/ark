import { Router, type Request, type Response } from 'express'

import {
  duplicateWorkspaceRequestSchema,
  isValidDeckId,
  parseRequestBody,
  workspacePathRequestSchema,
} from '@ark/contracts'
import type { WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'
import { registerWorkspaceHistoryRoutes } from './workspaces-history.ts'
import { toDeck, workspaceActionError } from './workspaces-shared.ts'

export function createWorkspacesRouter(
  workspaces: WorkspaceStore,
  options: {
    onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  } = {},
) {
  const router = Router()
  const notifyDocumentPersisted = (deckId: string, documentRevision: number) =>
    options.onDocumentPersisted?.(deckId, documentRevision)

  registerWorkspaceOpenRoutes(router, workspaces)
  registerWorkspaceFileRoutes(router, workspaces)
  registerWorkspaceHistoryRoutes(router, workspaces, notifyDocumentPersisted)
  return router
}

function registerWorkspaceOpenRoutes(router: Router, workspaces: WorkspaceStore) {
  router.post('/api/workspaces/open', async (request: Request, response: Response) => {
    const parsed = parseRequestBody(workspacePathRequestSchema, request.body)
    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }
    try {
      response.json({ deck: toDeck(await workspaces.open(parsed.data.path)) })
    } catch (error) {
      sendApiError(response, 400, getApiErrorFromUnknown(error))
    }
  })

  router.post('/api/workspaces/:id/locate', async (request: Request<{ id: string }>, response) => {
    const parsed = parseRequestBody(workspacePathRequestSchema, request.body)
    if (!isValidDeckId(request.params.id) || !parsed.ok) {
      response.status(400).json({ error: parsed.ok ? 'Invalid workspace id.' : parsed.error })
      return
    }
    try {
      response.json({ deck: toDeck(await workspaces.locate(request.params.id, parsed.data.path)) })
    } catch (error) {
      sendApiError(response, 400, getApiErrorFromUnknown(error))
    }
  })

  router.delete(
    '/api/workspaces/:id/recent',
    async (request: Request<{ id: string }>, response) => {
      if (!isValidDeckId(request.params.id)) {
        response.status(400).json({ error: 'Invalid workspace id.' })
        return
      }
      await workspaces.removeRecent(request.params.id)
      response.status(204).send()
    },
  )
}

function registerWorkspaceFileRoutes(router: Router, workspaces: WorkspaceStore) {
  for (const action of ['save-as', 'move'] as const) {
    router.post(`/api/decks/:id/${action}`, async (request: Request<{ id: string }>, response) => {
      const id = request.params.id
      const parsed = parseRequestBody(workspacePathRequestSchema, request.body)
      if (!isValidDeckId(id) || !parsed.ok) {
        response.status(400).json({ error: parsed.ok ? 'Invalid deck id.' : parsed.error })
        return
      }
      try {
        const workspace =
          action === 'save-as'
            ? await workspaces.saveAs(id, parsed.data.path, parsed.data.overwrite ?? false)
            : await workspaces.move(id, parsed.data.path, parsed.data.overwrite ?? false)
        if (!workspace) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }
        response.json({ deck: toDeck(workspace) })
      } catch (error) {
        const { status, payload } = workspaceActionError(error)
        sendApiError(response, status, payload)
      }
    })
  }

  router.post('/api/decks/:id/duplicate', async (request: Request<{ id: string }>, response) => {
    const parsed = parseRequestBody(duplicateWorkspaceRequestSchema, request.body)
    if (!isValidDeckId(request.params.id) || !parsed.ok) {
      response.status(400).json({ error: parsed.ok ? 'Invalid deck id.' : parsed.error })
      return
    }
    try {
      const workspace = await workspaces.duplicate(
        request.params.id,
        parsed.data.mode,
        parsed.data.path,
        parsed.data.threadIds,
        parsed.data.overwrite ?? false,
      )
      if (!workspace) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }
      response.status(201).json({ deck: toDeck(workspace) })
    } catch (error) {
      const { status, payload } = workspaceActionError(error)
      sendApiError(response, status, payload)
    }
  })
}
