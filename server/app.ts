import express, { type Request, type Response } from 'express'

import { type StartGenerationJobRequest } from '../shared/generation-job.ts'
import {
  hasAnyConfiguredProvider,
  missingApiKeyError,
  parseProviderError,
  getProviderStatus,
  type ApiErrorPayload,
} from './credentials.ts'
import { handleDeckAssetRequest } from './deck-assets.ts'
import { createDefaultDeckStore } from './deck-store.ts'
import { createDefaultChatStore } from './chat-store.ts'
import { type ChatStore, normalizeChatMessageLimit } from './chat-record.ts'
import {
  type DeckStore,
  type DeckVersionOptions,
  isValidDeckId,
  normalizeDeckVersionSource,
} from './deck-record.ts'
import { type GenerationJobStore, isValidGenerationJobId } from './generation-job-record.ts'
import { createDefaultGenerationJobStore } from './generation-job-store.ts'
import {
  createGenerationJobRunner,
  toGenerationJobResponse,
  type GenerationJobRunner,
} from './generation-job-runner.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import {
  ensureModelInList,
  fetchAllAvailableModels,
  getDefaultModel,
  getDefaultModelWarning,
} from './models.ts'
import { parseChatAttachments } from '../shared/chat.ts'
import type { AppendChatMessageRequest } from '../shared/chat-thread.ts'

type CreateAppOptions = {
  deckStore?: DeckStore
  chatStore?: ChatStore
  generationJobStore?: GenerationJobStore
  generationJobRunner?: GenerationJobRunner
}

function parseAppendChatMessageBody(
  body: AppendChatMessageRequest = {} as AppendChatMessageRequest,
) {
  const role = body.role

  if (role !== 'user' && role !== 'assistant') {
    return { ok: false as const, error: 'Message role must be "user" or "assistant".' }
  }

  if (typeof body.content !== 'string') {
    return { ok: false as const, error: 'Message content must be a string.' }
  }

  const parsedAttachments = parseChatAttachments(body.attachments, 0)

  if (!parsedAttachments.ok) {
    return { ok: false as const, error: parsedAttachments.error }
  }

  return {
    ok: true as const,
    message: {
      id: typeof body.id === 'string' ? body.id : undefined,
      role,
      content: body.content.trim(),
      parts: Array.isArray(body.parts) ? body.parts : undefined,
      attachments:
        parsedAttachments.attachments.length > 0 ? parsedAttachments.attachments : undefined,
      deckVersionId: typeof body.deckVersionId === 'string' ? body.deckVersionId : null,
      generationJobId: typeof body.generationJobId === 'string' ? body.generationJobId : null,
      generationStatus: typeof body.generationStatus === 'string' ? body.generationStatus : null,
      model: typeof body.model === 'string' ? body.model : null,
      error:
        body.error && typeof body.error.message === 'string'
          ? {
              message: body.error.message,
              code: typeof body.error.code === 'string' ? body.error.code : null,
            }
          : null,
    },
  }
}

function toChatApiMessage(message: {
  id: string
  threadId: string
  deckId: string
  deckVersionId: string | null
  role: 'user' | 'assistant'
  content: string
  parts?: AppendChatMessageRequest['parts']
  attachments?: AppendChatMessageRequest['attachments']
  generationJobId?: string | null
  generationStatus?: string | null
  model?: string | null
  error?: { message: string; code?: string | null } | null
  createdAt: string
}) {
  return {
    id: message.id,
    threadId: message.threadId,
    deckId: message.deckId,
    deckVersionId: message.deckVersionId,
    role: message.role,
    content: message.content,
    ...(message.parts?.length ? { parts: message.parts } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    generationJobId: message.generationJobId ?? null,
    generationStatus: message.generationStatus ?? null,
    model: message.model ?? null,
    error: message.error ?? null,
    createdAt: message.createdAt,
  }
}

type DeckVersionRequestBody = {
  source?: unknown
  summary?: unknown
  modelProvider?: unknown
  modelName?: unknown
}

function parseDeckVersionOptions(body: DeckVersionRequestBody = {}): DeckVersionOptions {
  const options: DeckVersionOptions = {
    source: normalizeDeckVersionSource(body.source),
    validationStatus: 'valid',
  }

  if (typeof body.summary === 'string' && body.summary.trim()) {
    options.summary = body.summary.trim()
  }

  if (typeof body.modelProvider === 'string' && body.modelProvider.trim()) {
    options.modelProvider = body.modelProvider.trim()
  }

  if (typeof body.modelName === 'string' && body.modelName.trim()) {
    options.modelName = body.modelName.trim()
  }

  return options
}

const sendApiError = (response: Response, status: number, payload: ApiErrorPayload) => {
  response.status(status).json(payload)
}

const sendDeckValidationError = (
  response: Response,
  validation: ReturnType<typeof validateDeckHtmlOnServer>,
) => {
  const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

  response.status(400).json({
    error: primaryIssue?.message ?? 'The HTML is not a valid Ark deck.',
    validation,
  })
}

const getApiErrorFromUnknown = (error: unknown): ApiErrorPayload => {
  if (
    error &&
    typeof error === 'object' &&
    'apiError' in error &&
    error.apiError &&
    typeof error.apiError === 'object' &&
    'code' in error.apiError &&
    'error' in error.apiError
  ) {
    return error.apiError as ApiErrorPayload
  }

  return parseProviderError(error)
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const deckStore = options.deckStore ?? createDefaultDeckStore()
  const chatStore = options.chatStore ?? createDefaultChatStore()
  const jobStore = options.generationJobStore ?? createDefaultGenerationJobStore()
  const generationJobs =
    options.generationJobRunner ?? createGenerationJobRunner({ deckStore, jobStore, chatStore })
  const defaultModel = getDefaultModel()

  app.use(express.json({ limit: '12mb' }))

  app.get('/api/deck-assets', async (request: Request, response: Response) => {
    try {
      await handleDeckAssetRequest(request, response)
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.get('/api/health', (_request: Request, response: Response) => {
    const configured = hasAnyConfiguredProvider()

    response.json({
      ok: true,
      model: defaultModel,
      apiKey: {
        configured,
      },
      providers: getProviderStatus(),
    })
  })

  app.get('/api/models', async (_request: Request, response: Response) => {
    try {
      const { models, warnings } = await fetchAllAvailableModels()
      const modelsWithDefault = ensureModelInList(models, defaultModel)
      const defaultModelWarning = getDefaultModelWarning(modelsWithDefault, defaultModel)

      response.json({
        defaultModel,
        models: modelsWithDefault,
        warnings: defaultModelWarning ? [...warnings, defaultModelWarning] : warnings,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.get('/api/decks', async (_request: Request, response: Response) => {
    try {
      const decks = await deckStore.listDecks()

      response.json({ decks })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.get('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
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

      response.json({ deck })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.post(
    '/api/decks',
    async (
      request: Request<unknown, unknown, { html?: string } & DeckVersionRequestBody>,
      response: Response,
    ) => {
      const html = request.body.html ?? ''

      if (!html.trim()) {
        response.status(400).json({ error: 'HTML is required.' })
        return
      }

      const validation = validateDeckHtmlOnServer(html)

      if (!validation.valid) {
        sendDeckValidationError(response, validation)
        return
      }

      try {
        const deck = await deckStore.createDeck(html, parseDeckVersionOptions(request.body))
        response.status(201).json({ deck, validation })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.put(
    '/api/decks/:id',
    async (
      request: Request<{ id: string }, unknown, { html?: string } & DeckVersionRequestBody>,
      response: Response,
    ) => {
      const id = request.params.id?.trim()
      const html = request.body.html ?? ''

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      if (!html.trim()) {
        response.status(400).json({ error: 'HTML is required.' })
        return
      }

      const validation = validateDeckHtmlOnServer(html)

      if (!validation.valid) {
        sendDeckValidationError(response, validation)
        return
      }

      try {
        const deck = await deckStore.updateDeck(id, html, parseDeckVersionOptions(request.body))

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        response.json({ deck, validation })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.patch(
    '/api/decks/:id',
    async (request: Request<{ id: string }, unknown, { title?: unknown }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      const title = request.body?.title

      if (typeof title !== 'string') {
        response.status(400).json({ error: 'Deck title is required.' })
        return
      }

      try {
        const deck = await deckStore.updateDeckMetadata(id, { title })

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        response.json({ deck })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.get(
    '/api/decks/:id/versions',
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
        const versions = await deckStore.listVersions(id)

        if (!versions) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        response.json({ versions })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.get(
    '/api/decks/:id/versions/:versionId',
    async (request: Request<{ id: string; versionId: string }>, response: Response) => {
      const id = request.params.id?.trim()
      const versionId = request.params.versionId?.trim()

      if (!id || !versionId) {
        response.status(400).json({ error: 'Deck id and version id are required.' })
        return
      }

      if (!isValidDeckId(id) || !isValidDeckId(versionId)) {
        response.status(400).json({ error: 'Invalid deck id or version id.' })
        return
      }

      try {
        const version = await deckStore.getVersion(id, versionId)

        if (!version) {
          response.status(404).json({ error: 'Version not found.' })
          return
        }

        response.json({ version })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.post(
    '/api/decks/:id/rollback',
    async (
      request: Request<{ id: string }, unknown, { versionId?: string }>,
      response: Response,
    ) => {
      const id = request.params.id?.trim()
      const versionId = request.body.versionId?.trim()

      if (!id || !versionId) {
        response.status(400).json({ error: 'Deck id and version id are required.' })
        return
      }

      if (!isValidDeckId(id) || !isValidDeckId(versionId)) {
        response.status(400).json({ error: 'Invalid deck id or version id.' })
        return
      }

      try {
        const targetVersion = await deckStore.getVersion(id, versionId)

        if (!targetVersion) {
          response.status(404).json({ error: 'Version not found.' })
          return
        }

        const validation = validateDeckHtmlOnServer(targetVersion.html)

        if (!validation.valid) {
          sendDeckValidationError(response, validation)
          return
        }

        const deck = await deckStore.rollbackToVersion(id, versionId)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        response.json({ deck, validation })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.get('/api/decks/:id/chat', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    const limit = normalizeChatMessageLimit(
      request.query.limit ? Number(request.query.limit) : undefined,
    )
    const before =
      typeof request.query.before === 'string' ? request.query.before.trim() : undefined

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
  })

  app.post(
    '/api/decks/:id/chat/messages',
    async (
      request: Request<{ id: string }, unknown, AppendChatMessageRequest>,
      response: Response,
    ) => {
      const id = request.params.id?.trim()

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      const parsed = parseAppendChatMessageBody(request.body)

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      try {
        const deck = await deckStore.getDeck(id)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const message = await chatStore.appendMessage(id, parsed.message)

        response.status(201).json({ message: toChatApiMessage(message) })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.delete(
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

  app.delete('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
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
      const deleted = await deckStore.deleteDeck(id)

      if (!deleted) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.status(204).send()
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.post(
    '/api/generation-jobs',
    async (request: Request<unknown, unknown, StartGenerationJobRequest>, response: Response) => {
      if (!hasAnyConfiguredProvider()) {
        sendApiError(response, 503, missingApiKeyError())
        return
      }

      const deckId = request.body.deckId?.trim()

      if (deckId && !isValidDeckId(deckId)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      try {
        const job = await generationJobs.startJob({
          body: request.body,
          defaultModel,
        })

        response.status(202).json(toGenerationJobResponse(job))
      } catch (error) {
        const apiError = getApiErrorFromUnknown(error)
        const status = apiError.code === 'provider_error' ? 400 : 500
        sendApiError(response, status, apiError)
      }
    },
  )

  app.get(
    '/api/generation-jobs/:id',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id || !isValidGenerationJobId(id)) {
        response.status(400).json({ error: 'Invalid generation job id.' })
        return
      }

      try {
        const job = await generationJobs.getJob(id)

        if (!job) {
          response.status(404).json({ error: 'Generation job not found.' })
          return
        }

        response.json(toGenerationJobResponse(job))
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.post(
    '/api/generation-jobs/:id/cancel',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id || !isValidGenerationJobId(id)) {
        response.status(400).json({ error: 'Invalid generation job id.' })
        return
      }

      try {
        const job = await generationJobs.cancelJob(id)

        if (!job) {
          response.status(404).json({ error: 'Generation job not found.' })
          return
        }

        response.json(toGenerationJobResponse(job))
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  app.post(
    '/api/generation-jobs/:id/retry',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id || !isValidGenerationJobId(id)) {
        response.status(400).json({ error: 'Invalid generation job id.' })
        return
      }

      if (!hasAnyConfiguredProvider()) {
        sendApiError(response, 503, missingApiKeyError())
        return
      }

      try {
        const job = await generationJobs.retryJob(id)

        if (!job) {
          response.status(404).json({ error: 'Generation job cannot be retried.' })
          return
        }

        response.status(202).json(toGenerationJobResponse(job))
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return app
}
