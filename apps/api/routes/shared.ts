import { type Response } from 'express'

import type { AppendChatMessageRequest } from '@ark/contracts'
import { deckVersionProvenanceSchema, normalizeDeckVersionProvenance } from '@ark/contracts'
import { parseProviderError, type ApiErrorPayload } from '../credentials.ts'
import { type DeckVersionOptions, normalizeDeckVersionSource } from '../deck-record.ts'
import { validateDeckHtmlOnServer } from '../deck-validate.ts'
import { getRequestLogger } from '../observability/index.ts'

export function toChatApiMessage(message: {
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

export function parseDeckVersionOptions(
  body: {
    source?: unknown
    summary?: unknown
    modelProvider?: unknown
    modelName?: unknown
    provenance?: unknown
  } = {},
): DeckVersionOptions {
  const source = normalizeDeckVersionSource(body.source)
  const options: DeckVersionOptions = {
    source,
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

  if (source === 'manual' && body.provenance !== undefined) {
    const parsedProvenance = deckVersionProvenanceSchema.safeParse(body.provenance)

    if (parsedProvenance.success) {
      options.provenance = normalizeDeckVersionProvenance(parsedProvenance.data) ?? undefined
    }
  }

  return options
}

export const sendApiError = (response: Response, status: number, payload: ApiErrorPayload) => {
  response.status(status).json(payload)
}

export const sendDeckValidationError = (
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

export const getApiErrorFromUnknown = (error: unknown): ApiErrorPayload => {
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
