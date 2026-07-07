import { Router, type Request, type Response } from 'express'

import {
  appendChatMessageRequestSchema,
  deckChatQuerySchema,
  parseRequestBody,
} from '@ark/contracts'
import { type ChatStore, normalizeChatMessageLimit } from '../chat-record.ts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { getApiErrorFromUnknown, sendApiError, toChatApiMessage } from './shared.ts'

export function createDeckChatRouter(deps: { deckStore: DeckStore; chatStore: ChatStore }): Router {
  const { deckStore, chatStore } = deps
  const router = Router()

  router.get(
    '/api/decks/:id/chat',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      const parsedQuery = parseRequestBody(deckChatQuerySchema, {
        limit: request.query.limit,
        before: request.query.before,
      })

      if (!parsedQuery.ok) {
        response.status(400).json({ error: parsedQuery.error })
        return
      }

      const limit = normalizeChatMessageLimit(parsedQuery.data.limit)
      const before = parsedQuery.data.before?.trim() || undefined

      try {
        const deck = await deckStore.getDeck(id)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const result = await chatStore.listMessages(id, { limit, before })

        response.json({
          thread: result.thread,
          messages: result.messages.map(toChatApiMessage),
          hasMore: result.hasMore,
        })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.post(
    '/api/decks/:id/chat/messages',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      const parsed = parseRequestBody(appendChatMessageRequestSchema, request.body)

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      const messageInput = {
        id: parsed.data.id,
        role: parsed.data.role,
        content: parsed.data.content.trim(),
        parts: parsed.data.parts,
        attachments: parsed.data.attachments,
        deckVersionId: parsed.data.deckVersionId ?? null,
        generationJobId: parsed.data.generationJobId ?? null,
        generationStatus: parsed.data.generationStatus ?? null,
        model: parsed.data.model ?? null,
        error: parsed.data.error ?? null,
      }

      try {
        const deck = await deckStore.getDeck(id)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const message = await chatStore.appendMessage(id, messageInput)

        response.status(201).json({ message: toChatApiMessage(message) })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.delete(
    '/api/decks/:id/chat',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      try {
        const deck = await deckStore.getDeck(id)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        await chatStore.clearThread(id)
        response.status(204).send()
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return router
}
