import { type LanguageModel } from 'ai'
import express, { type Request, type Response } from 'express'

import { parseGenerateMessages, type ApiChatMessage } from '../shared/chat.ts'
import {
  hasAnyConfiguredProvider,
  missingApiKeyError,
  parseProviderError,
  getProviderStatus,
  type ApiErrorPayload,
} from './credentials.ts'
import { handleDeckAssetRequest } from './deck-assets.ts'
import { runDeckAgent } from './deck-agent.ts'
import { createDefaultDeckStore } from './deck-store.ts'
import {
  type DeckStore,
  type DeckVersionOptions,
  isValidDeckId,
  normalizeDeckVersionSource,
} from './deck-record.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import {
  ensureModelInList,
  fetchAllAvailableModels,
  getDefaultModel,
  getDefaultModelWarning,
} from './models.ts'
import { createLanguageModel } from './provider-runtime.ts'

type GenerateRequest = {
  messages?: unknown
  currentHtml?: string | null
  model?: string
}

type CreateAppOptions = {
  deckStore?: DeckStore
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
    '/api/generate',
    async (request: Request<unknown, unknown, GenerateRequest>, response: Response) => {
      const parsedMessages = parseGenerateMessages(request.body.messages)
      const currentHtml = request.body.currentHtml ?? ''
      const requestedModel = request.body.model?.trim()
      const modelRef = requestedModel || defaultModel

      if (!parsedMessages.ok) {
        response.status(400).json({ error: parsedMessages.error, code: 'provider_error' })
        return
      }

      const messages: ApiChatMessage[] = parsedMessages.messages

      if (!hasAnyConfiguredProvider()) {
        sendApiError(response, 503, missingApiKeyError())
        return
      }

      if (messages.length === 0) {
        response
          .status(400)
          .json({ error: 'At least one user message is required.', code: 'provider_error' })
        return
      }

      if (messages.at(-1)?.role !== 'user') {
        response.status(400).json({
          error: 'The latest chat message must be from the user.',
          code: 'provider_error',
        })
        return
      }

      try {
        const { model } = createLanguageModel(modelRef)

        const agentResult = await runDeckAgent({
          model: model as LanguageModel,
          messages,
          currentHtml,
        })

        if (!agentResult.ok) {
          response.status(502).json({
            error: agentResult.error,
            code: 'provider_error',
            validation: agentResult.validation,
            steps: agentResult.steps,
          })
          return
        }

        response.json({
          html: agentResult.html,
          validation: agentResult.validation,
          steps: agentResult.steps,
          text: agentResult.assistantText,
        })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return app
}
