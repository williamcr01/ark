import { type Response } from 'express'

import type { AppendChatMessageRequest } from '@ark/contracts'
import type { ApiErrorPayload } from '@ark/contracts'
import { parseProviderError } from '@ark/ai/credentials.ts'
import { validateDeckHtmlOnServer } from '../deck-validate.ts'
import { getRequestLogger } from '../observability/index.ts'

export function toChatApiMessage(message: {
  id: string
  threadId: string
  deckId: string
  documentRevision: number | null
  role: 'user' | 'assistant'
  content: string
  parts?: AppendChatMessageRequest['parts']
  attachments?: AppendChatMessageRequest['attachments']
  context?: AppendChatMessageRequest['context']
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
    documentRevision: message.documentRevision,
    role: message.role,
    content: message.content,
    ...(message.parts?.length ? { parts: message.parts } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.context ? { context: message.context } : {}),
    generationJobId: message.generationJobId ?? null,
    generationStatus: message.generationStatus ?? null,
    model: message.model ?? null,
    error: message.error ?? null,
    createdAt: message.createdAt,
  }
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
