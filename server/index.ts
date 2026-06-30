import 'dotenv/config'

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
import { deckStore, isValidDeckId } from './deck-store.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import {
  ensureModelInList,
  fetchAllAvailableModels,
  getDefaultModel,
  getDefaultModelWarning,
} from './models.ts'
import { createLanguageModel } from './provider-runtime.ts'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const defaultModel = getDefaultModel()

app.use(express.json({ limit: '4mb' }))

type GenerateRequest = {
  messages?: unknown
  currentHtml?: string | null
  model?: string
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
  async (request: Request<unknown, unknown, { html?: string }>, response: Response) => {
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
      const deck = await deckStore.createDeck(html)
      response.status(201).json({ deck, validation })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  },
)

app.put(
  '/api/decks/:id',
  async (request: Request<{ id: string }, unknown, { html?: string }>, response: Response) => {
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
      const deck = await deckStore.updateDeck(id, html)

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

app.listen(port, () => {
  console.log(`Ark API server listening on http://localhost:${port}`)
})
