import express, { type Request, type Response } from 'express'

import { appendChatMessageRequestSchema, deckChatQuerySchema } from '../shared/api/chat.ts'
import {
  createDeckRequestSchema,
  renameDeckRequestSchema,
  rollbackDeckRequestSchema,
} from '../shared/api/decks.ts'
import { createPreviewSessionRequestSchema } from '../shared/api/preview.ts'
import { startGenerationJobRequestSchema } from '../shared/api/generation-jobs.ts'
import { parseRequestBody } from '../shared/api/common.ts'
import {
  buildSandboxRenderUrl,
  resolveAppOrigin,
  resolveSandboxOrigin,
} from '../shared/sandbox-origin.ts'
import {
  hasAnyConfiguredProvider,
  missingApiKeyError,
  parseProviderError,
  getProviderStatus,
  type ApiErrorPayload,
} from './credentials.ts'
import { handleDeckAssetRequest } from './deck-assets.ts'
import { handleRuntimeRoutes } from './deck-runtimes.ts'
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
import { buildDeckVersionOptions } from './deck-version-payload.ts'
import {
  ensureModelInList,
  fetchAllAvailableModels,
  getDefaultModel,
  getDefaultModelWarning,
} from './models.ts'
import type { AppendChatMessageRequest } from '../shared/chat-thread.ts'
import { createPreviewSessionStore, type PreviewSessionStore } from './preview-sessions.ts'
import {
  createObservabilityMiddleware,
  createRuntimeErrorStore,
  getRequestId,
  getRequestLogger,
  parseRuntimeErrorBody,
  type RuntimeErrorStore,
} from './observability/index.ts'

type CreateAppOptions = {
  deckStore?: DeckStore
  chatStore?: ChatStore
  generationJobStore?: GenerationJobStore
  generationJobRunner?: GenerationJobRunner
  previewSessionStore?: PreviewSessionStore
  runtimeErrorStore?: RuntimeErrorStore
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

function parseDeckVersionOptions(
  body: {
    source?: unknown
    summary?: unknown
    modelProvider?: unknown
    modelName?: unknown
  } = {},
): DeckVersionOptions {
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
  request?: object,
) => {
  const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

  if (request) {
    getRequestLogger(request).warn('deck.validation.failed', {
      issueCount: validation.issues.length,
      primaryCode: primaryIssue?.code ?? null,
      statusCode: 400,
    })
  }

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
  const previewSessionStore = options.previewSessionStore ?? createPreviewSessionStore()
  const runtimeErrorStore = options.runtimeErrorStore ?? createRuntimeErrorStore()
  const defaultModel = getDefaultModel()

  app.use(createObservabilityMiddleware())
  app.use(express.json({ limit: '12mb' }))

  app.get('/api/deck-assets', async (request: Request, response: Response) => {
    try {
      await handleDeckAssetRequest(request, response)
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.use(handleRuntimeRoutes)

  app.get('/api/health', (_request: Request, response: Response) => {
    const configured = hasAnyConfiguredProvider()

    response.json({
      ok: true,
      model: defaultModel,
      apiKey: {
        configured,
      },
      providers: getProviderStatus(),
      preview: {
        sandboxOrigin: resolveSandboxOrigin(),
        appOrigin: resolveAppOrigin(),
      },
    })
  })

  app.post('/api/preview-sessions', async (request: Request, response: Response) => {
    const parsed = parseRequestBody(createPreviewSessionRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const session = previewSessionStore.createSession(parsed.data.html)

    response.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      sandboxOrigin: resolveSandboxOrigin(),
      renderUrl: buildSandboxRenderUrl(session.token, {
        sandboxOrigin: resolveSandboxOrigin(),
        appOrigin: resolveAppOrigin(),
      }),
    })
  })

  app.get(
    '/api/preview-sessions/:token',
    (request: Request<{ token: string }>, response: Response) => {
      const token = request.params.token?.trim()

      if (!token) {
        response.status(400).json({ error: 'Preview token is required.' })
        return
      }

      const session = previewSessionStore.getSession(token)

      if (!session) {
        response.status(404).json({ error: 'Preview session not found or expired.' })
        return
      }

      response.json({
        token: session.token,
        html: session.html,
        expiresAt: session.expiresAt,
      })
    },
  )

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

  app.post('/api/decks', async (request: Request, response: Response) => {
    const parsed = parseRequestBody(createDeckRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const { html, ...versionBody } = parsed.data
    const validation = validateDeckHtmlOnServer(html)

    if (!validation.valid) {
      sendDeckValidationError(response, validation, request)
      return
    }

    try {
      const versionOptions = buildDeckVersionOptions(
        html,
        parseDeckVersionOptions(versionBody),
        validation,
      )
      const deck = await deckStore.createDeck(html, versionOptions)
      getRequestLogger(request).info('deck.created', {
        deckId: deck.id,
        statusCode: 201,
      })
      response.status(201).json({
        deck,
        validation,
        runtimeManifest: versionOptions.runtimeManifest ?? null,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.put('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()
    const parsed = parseRequestBody(createDeckRequestSchema, request.body)

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const { html, ...versionBody } = parsed.data
    const validation = validateDeckHtmlOnServer(html)

    if (!validation.valid) {
      sendDeckValidationError(response, validation, request)
      return
    }

    try {
      const versionOptions = buildDeckVersionOptions(
        html,
        parseDeckVersionOptions(versionBody),
        validation,
      )
      const deck = await deckStore.updateDeck(id, html, versionOptions)

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.json({
        deck,
        validation,
        runtimeManifest: versionOptions.runtimeManifest ?? null,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.post('/api/decks/:id/patch', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    const { deckPatchRequestSchema } = await import('../shared/deck-patch.ts')
    const parsedBody = deckPatchRequestSchema.safeParse({
      operations: request.body?.operations,
      activeSlideIndex: request.body?.activeSlideIndex,
    })

    if (!parsedBody.success) {
      response.status(400).json({
        error: parsedBody.error.issues[0]?.message ?? 'Invalid patch request.',
      })
      return
    }

    try {
      const existing = await deckStore.getDeck(id)

      if (!existing) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      const { applyDeckPatches } = await import('./deck-patch.ts')
      const patched = applyDeckPatches(existing.html, parsedBody.data.operations, {
        activeSlideIndex: parsedBody.data.activeSlideIndex,
      })

      if (!patched.ok) {
        response.status(400).json({
          error: patched.error,
          operationIndex: patched.operationIndex,
        })
        return
      }

      const validation = validateDeckHtmlOnServer(patched.html)

      if (!validation.valid) {
        sendDeckValidationError(response, validation, request)
        return
      }

      const versionOptions = parseDeckVersionOptions(request.body)
      versionOptions.summary = versionOptions.summary ?? patched.summary

      const deck = await deckStore.updateDeck(id, patched.html, versionOptions)

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.json({
        deck,
        validation,
        patch: {
          appliedCount: patched.appliedCount,
          changedSlideIndexes: patched.changedSlideIndexes,
          changedElementIds: patched.changedElementIds,
          summary: patched.summary,
          suggestedActiveSlideIndex: patched.suggestedActiveSlideIndex,
        },
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  app.patch('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    const parsed = parseRequestBody(renameDeckRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    try {
      const deck = await deckStore.updateDeckMetadata(id, { title: parsed.data.title })

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.json({ deck })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

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
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()
      const parsed = parseRequestBody(rollbackDeckRequestSchema, request.body)

      if (!id) {
        response.status(400).json({ error: 'Deck id and version id are required.' })
        return
      }

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      const versionId = parsed.data.versionId

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
          sendDeckValidationError(response, validation, request)
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
  })

  app.post(
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

  app.post('/api/generation-jobs', async (request: Request, response: Response) => {
    if (!hasAnyConfiguredProvider()) {
      sendApiError(response, 503, missingApiKeyError())
      return
    }

    const parsed = parseRequestBody(startGenerationJobRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const body = parsed.data
    const deckId = body.deckId?.trim()

    if (deckId && !isValidDeckId(deckId)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    try {
      const job = await generationJobs.startJob({
        body,
        defaultModel,
        requestId: getRequestId(request),
      })

      getRequestLogger(request).info('generation.job.enqueued', {
        jobId: job.id,
        deckId: job.deckId,
        model: job.model,
        statusCode: 202,
      })

      response.status(202).json(toGenerationJobResponse(job))
    } catch (error) {
      const apiError = getApiErrorFromUnknown(error)
      const status = apiError.code === 'provider_error' ? 400 : 500
      sendApiError(response, status, apiError)
    }
  })

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

  app.post('/api/runtime-errors', (request: Request, response: Response) => {
    const parsed = parseRuntimeErrorBody(request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const record = runtimeErrorStore.record({
      ...parsed.input,
      requestId: parsed.input.requestId ?? getRequestId(request),
    })

    getRequestLogger(request).warn('runtime.error.reported', {
      runtimeErrorId: record.id,
      deckId: record.deckId,
      versionId: record.versionId,
      slideIndex: record.slideIndex,
      runtimeMode: record.runtimeMode,
      severity: record.severity,
      statusCode: 201,
    })

    response.status(201).json({
      id: record.id,
      createdAt: record.createdAt,
    })
  })

  return app
}
