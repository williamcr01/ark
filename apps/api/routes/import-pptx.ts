import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Router, type Request, type Response } from 'express'

import { importPptxRequestSchema, parseRequestBody, type ApiErrorCode } from '@ark/contracts'
import { importPptxToHtml, isPptxImportError } from '@ark/deck-import'
import { buildDeckRuntimeManifestFromValidation } from '@ark/storage/fs/deck-manifest.ts'
import { type DeckStore } from '@ark/storage/records/deck-record.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError, sendDeckValidationError } from './shared.ts'

const MAX_PPTX_BYTES = 50 * 1024 * 1024

function sendPptxError(response: Response, message: string, code: ApiErrorCode) {
  sendApiError(response, 400, { error: message, code })
}

export function createImportPptxRouter(deps: {
  deckStore: DeckStore
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
}): Router {
  const { deckStore, onDocumentPersisted } = deps
  const router = Router()

  router.post('/api/decks/import-pptx', async (request: Request, response: Response) => {
    const parsed = parseRequestBody(importPptxRequestSchema, request.body)
    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const filename =
      parsed.data.filename?.trim() ||
      (parsed.data.path ? path.basename(parsed.data.path) : 'deck.pptx')

    try {
      let bytes: Uint8Array
      if (parsed.data.bytes) {
        bytes = Buffer.from(parsed.data.bytes, 'base64')
      } else if (parsed.data.path) {
        bytes = await readFile(parsed.data.path)
      } else {
        response.status(400).json({ error: 'Provide a file path or the PPTX bytes.' })
        return
      }

      if (bytes.byteLength === 0 || bytes.byteLength > MAX_PPTX_BYTES) {
        sendPptxError(
          response,
          'That PowerPoint file is empty or larger than the 50 MB import limit.',
          'pptx_invalid',
        )
        return
      }

      const imported = await importPptxToHtml(bytes, { filename })
      const validation = validateDeckHtmlOnServer(imported.html, {
        logger: getRequestLogger(request),
      })
      if (!validation.valid) {
        sendDeckValidationError(response, validation, request)
        return
      }

      const runtimeManifest = buildDeckRuntimeManifestFromValidation(imported.html, validation)
      const deck = await deckStore.createDeck(imported.html, { origin: 'authored' })
      onDocumentPersisted?.(deck.id, deck.documentRevision)
      getRequestLogger(request).info('deck.imported.pptx', {
        deckId: deck.id,
        slideCount: imported.slideCount,
        warningCount: imported.warnings.length,
        statusCode: 201,
      })
      response.status(201).json({
        deck,
        validation,
        runtimeManifest,
        warnings: imported.warnings,
      })
    } catch (error) {
      if (isPptxImportError(error)) {
        sendPptxError(response, error.message, error.code)
        return
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        sendPptxError(response, 'That PowerPoint file could not be read.', 'pptx_invalid')
        return
      }
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  return router
}
