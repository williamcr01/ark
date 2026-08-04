import { Router, type Request } from 'express'

import {
  createChatThreadRequestSchema,
  isValidDeckId,
  parseRequestBody,
  updateChatThreadRequestSchema,
} from '@ark/contracts'
import { isValidChatThreadId, type ChatStore } from '../chat-record.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

const sendThreadError = (response: import('express').Response, error: unknown) => {
  const status = error instanceof Error && error.message === 'Deck not found.' ? 404 : 500
  sendApiError(response, status, getApiErrorFromUnknown(error))
}

export function createDeckThreadsRouter(chatStore: ChatStore) {
  const router = Router()
  router.get('/api/decks/:id/threads', async (request: Request<{ id: string }>, response) => {
    if (!isValidDeckId(request.params.id))
      return response.status(400).json({ error: 'Invalid deck id.' })
    try {
      response.json({ threads: await chatStore.listThreads(request.params.id) })
    } catch (error) {
      sendThreadError(response, error)
    }
  })
  router.post('/api/decks/:id/threads', async (request: Request<{ id: string }>, response) => {
    const parsed = parseRequestBody(createChatThreadRequestSchema, request.body)
    if (!isValidDeckId(request.params.id) || !parsed.ok)
      return response.status(400).json({ error: parsed.ok ? 'Invalid deck id.' : parsed.error })
    try {
      response
        .status(201)
        .json({ thread: await chatStore.createThread(request.params.id, parsed.data.title) })
    } catch (error) {
      sendThreadError(response, error)
    }
  })
  router.patch(
    '/api/decks/:id/threads/:threadId',
    async (request: Request<{ id: string; threadId: string }>, response) => {
      const parsed = parseRequestBody(updateChatThreadRequestSchema, request.body)
      if (
        !isValidDeckId(request.params.id) ||
        !isValidChatThreadId(request.params.threadId) ||
        !parsed.ok
      )
        return response
          .status(400)
          .json({ error: parsed.ok ? 'Invalid deck or thread id.' : parsed.error })
      try {
        const thread = await chatStore.updateThread(
          request.params.id,
          request.params.threadId,
          parsed.data,
        )
        return thread
          ? response.json({ thread })
          : response.status(404).json({ error: 'Thread not found.' })
      } catch (error) {
        sendThreadError(response, error)
      }
    },
  )
  router.delete(
    '/api/decks/:id/threads/:threadId',
    async (request: Request<{ id: string; threadId: string }>, response) => {
      if (!isValidDeckId(request.params.id) || !isValidChatThreadId(request.params.threadId))
        return response.status(400).json({ error: 'Invalid deck or thread id.' })
      try {
        return (await chatStore.deleteThread(request.params.id, request.params.threadId))
          ? response.status(204).send()
          : response.status(404).json({ error: 'Thread not found.' })
      } catch (error) {
        sendThreadError(response, error)
      }
    },
  )
  return router
}
