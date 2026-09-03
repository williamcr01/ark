import type { Request, Response, Router } from 'express'
import { parseRequestBody, deckPatchRequestSchema } from '@ark/contracts'
import { isValidDeckId } from '@ark/storage/records/deck-record.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import { getRequestLogger } from '../observability/index.ts'
import { sendDeckValidationError } from './shared.ts'
import {
  notifyDocumentPersisted,
  sendDeckWriteError,
  type DecksRouterDeps,
} from './decks-helpers.ts'

function logDeckPatchCompleted(
  logger: ReturnType<typeof getRequestLogger>,
  details: {
    deckId: string
    startedAt: number
    loadMs: number
    applyMs: number
    validateMs: number
    persistMs: number
    notifyMs: number
    serializeMs: number
    htmlBytes: number
    operationCount: number
    appliedCount: number
    reusedValidation: boolean
    documentRevision: number
  },
) {
  logger.info('deck.patch.completed', {
    deckId: details.deckId,
    durationMs: Number((performance.now() - details.startedAt).toFixed(3)),
    loadMs: Number(details.loadMs.toFixed(3)),
    applyMs: Number(details.applyMs.toFixed(3)),
    validateMs: Number(details.validateMs.toFixed(3)),
    persistMs: Number(details.persistMs.toFixed(3)),
    notifyMs: Number(details.notifyMs.toFixed(3)),
    serializeMs: Number(details.serializeMs.toFixed(3)),
    htmlBytes: details.htmlBytes,
    operationCount: details.operationCount,
    appliedCount: details.appliedCount,
    reusedValidation: details.reusedValidation,
    documentRevision: details.documentRevision,
  })
}

async function handleDeckPatchRequest(
  request: Request<{ id: string }>,
  response: Response,
  deps: DecksRouterDeps,
) {
  const id = request.params.id?.trim()

  if (!id) {
    response.status(400).json({ error: 'Deck id is required.' })
    return
  }

  if (!isValidDeckId(id)) {
    response.status(400).json({ error: 'Invalid deck id.' })
    return
  }

  const parsedBody = parseRequestBody(deckPatchRequestSchema, {
    expectedDocumentRevision: request.body?.expectedDocumentRevision,
    operations: request.body?.operations,
    activeSlideIndex: request.body?.activeSlideIndex,
  })

  if (!parsedBody.ok) {
    response.status(400).json({
      error: parsedBody.error,
    })
    return
  }

  try {
    const logger = getRequestLogger(request)
    const startedAt = performance.now()
    const existing = await deps.deckStore.getDeck(id)
    const loadMs = performance.now() - startedAt

    if (!existing) {
      response.status(404).json({ error: 'Deck not found.' })
      return
    }

    const { applyDeckPatches } = await import('@ark/deck-node/patch/slide-ops.ts')
    const applyStartedAt = performance.now()
    const patched = applyDeckPatches(existing.html, parsedBody.data.operations, {
      activeSlideIndex: parsedBody.data.activeSlideIndex,
      logger,
    })
    const applyMs = performance.now() - applyStartedAt

    if (!patched.ok) {
      response.status(400).json({
        error: patched.error,
        operationIndex: patched.operationIndex,
      })
      return
    }

    const reusedValidation = Boolean(patched.validation)
    const validateStartedAt = performance.now()
    const validation =
      patched.validation ??
      validateDeckHtmlOnServer(patched.html, {
        logger,
      })
    const validateMs = performance.now() - validateStartedAt

    if (!validation.valid) {
      sendDeckValidationError(response, validation, request)
      return
    }

    const persistStartedAt = performance.now()
    const deck = await deps.deckStore.updateDeck(id, patched.html, {
      expectedDocumentRevision: parsedBody.data.expectedDocumentRevision,
      historySource: 'editor',
    })
    const persistMs = performance.now() - persistStartedAt

    if (!deck) {
      response.status(404).json({ error: 'Deck not found.' })
      return
    }

    const notifyStartedAt = performance.now()
    if (deps.onEditorPatchPersisted) {
      deps.onEditorPatchPersisted(deck.id, deck.documentRevision)
    } else {
      notifyDocumentPersisted(deps, deck.id, deck.documentRevision)
    }
    const notifyMs = performance.now() - notifyStartedAt

    const payload = {
      deck,
      validation,
      patch: {
        appliedCount: patched.appliedCount,
        changedSlideIndexes: patched.changedSlideIndexes,
        changedElementIds: patched.changedElementIds,
        summary: patched.summary,
        suggestedActiveSlideIndex: patched.suggestedActiveSlideIndex,
      },
    }
    const serializeStartedAt = performance.now()
    response.json(payload)
    const serializeMs = performance.now() - serializeStartedAt

    logDeckPatchCompleted(logger, {
      deckId: deck.id,
      startedAt,
      loadMs,
      applyMs,
      validateMs,
      persistMs,
      notifyMs,
      serializeMs,
      htmlBytes: Buffer.byteLength(patched.html, 'utf8'),
      operationCount: parsedBody.data.operations.length,
      appliedCount: patched.appliedCount,
      reusedValidation,
      documentRevision: deck.documentRevision,
    })
  } catch (error) {
    sendDeckWriteError(response, error)
  }
}

export function registerDeckPatchRoute(router: Router, deps: DecksRouterDeps) {
  router.post('/api/decks/:id/patch', (request: Request<{ id: string }>, response: Response) =>
    handleDeckPatchRequest(request, response, deps),
  )
}
