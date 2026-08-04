import { Router, type Request, type Response } from 'express'

import {
  duplicateWorkspaceRequestSchema,
  isValidDeckId,
  parseRequestBody,
  workspacePathRequestSchema,
  type StoredDeck,
} from '@ark/contracts'
import type { WorkspaceRow, WorkspaceStore } from '../workspace-store.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

const toDeck = (workspace: WorkspaceRow): StoredDeck => ({
  id: workspace.id,
  html: workspace.html,
  title: workspace.title,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
  documentRevision: workspace.documentRevision,
  filePath: workspace.path,
})

const workspaceActionStatus = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  if (/already exists|already open|same identity/i.test(message)) return 409
  if (/invalid|unsupported|different identity|could not open/i.test(message)) return 400
  return 500
}

export function createWorkspacesRouter(workspaces: WorkspaceStore) {
  const router = Router()

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
            ? await workspaces.saveAs(id, parsed.data.path)
            : await workspaces.move(id, parsed.data.path)
        if (!workspace) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }
        response.json({ deck: toDeck(workspace) })
      } catch (error) {
        sendApiError(response, workspaceActionStatus(error), getApiErrorFromUnknown(error))
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
      )
      if (!workspace) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }
      response.status(201).json({ deck: toDeck(workspace) })
    } catch (error) {
      sendApiError(response, workspaceActionStatus(error), getApiErrorFromUnknown(error))
    }
  })

  return router
}
