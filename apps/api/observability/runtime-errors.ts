import { randomUUID } from 'node:crypto'

import { isValidDeckId } from '@ark/storage/records/deck-record.ts'
import {
  runtimeErrorInputSchema,
  type RuntimeErrorInput,
  type RuntimeErrorRepairContext,
  type RuntimeErrorSeverity,
} from '@ark/contracts'
import { sanitizeRuntimeErrorText } from '@ark/telemetry/redact.ts'

export type { RuntimeErrorInput, RuntimeErrorSeverity } from '@ark/contracts'

export type RuntimeErrorRecord = {
  id: string
  deckId: string | null
  documentRevision: number | null
  slideIndex: number | null
  runtimeMode: string | null
  severity: RuntimeErrorSeverity
  message: string
  source: string | null
  stack: string | null
  requestId: string | null
  repairContext: RuntimeErrorRepairContext | null
  createdAt: string
}

export type RuntimeErrorStore = {
  record: (input: RuntimeErrorInput) => RuntimeErrorRecord
  listRecent: (limit?: number) => RuntimeErrorRecord[]
  listForDeck: (deckId: string, limit?: number) => RuntimeErrorRecord[]
}

const MAX_MESSAGE_LENGTH = 2_000
const MAX_STACK_LENGTH = 8_000
const MAX_SOURCE_LENGTH = 500
const MAX_RUNTIME_MODE_LENGTH = 64
const MAX_REPAIR_SUMMARY_LENGTH = 500
const DEFAULT_STORE_LIMIT = 500

function clampSlideIndex(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const index = Math.floor(value)

  if (index < 0) {
    return null
  }

  return index
}

export function parseRuntimeErrorBody(
  body: unknown,
): { ok: true; input: RuntimeErrorInput } | { ok: false; error: string } {
  const parsed = runtimeErrorInputSchema.safeParse(body)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Request body must be a JSON object.',
    }
  }

  const message = sanitizeRuntimeErrorText(parsed.data.message, MAX_MESSAGE_LENGTH)

  if (!message) {
    return { ok: false, error: 'message is required.' }
  }

  const deckId = parsed.data.deckId?.trim() || null

  if (deckId && !isValidDeckId(deckId)) {
    return { ok: false, error: 'Invalid deck id.' }
  }

  const documentRevision = parsed.data.documentRevision ?? null

  const runtimeModeRaw = parsed.data.runtimeMode?.trim().slice(0, MAX_RUNTIME_MODE_LENGTH) || null
  // Only keep fields we can derive from the top-level request. Client-supplied
  // previewMode / approvedRuntime / validation / relatedJobId are not trusted.
  const repairContext = parsed.data.repairContext
    ? {
        errorSummary: sanitizeRuntimeErrorText(message, MAX_REPAIR_SUMMARY_LENGTH),
        affectedSlideIndex: clampSlideIndex(parsed.data.slideIndex),
        runtime: {
          mode: runtimeModeRaw,
          previewMode: null,
          approvedRuntime: null,
        },
        validation: {
          status: 'unknown' as const,
          errors: 0,
          warnings: 0,
        },
        relatedJobId: null,
        documentRevision,
      }
    : undefined

  return {
    ok: true,
    input: {
      deckId,
      documentRevision,
      slideIndex: clampSlideIndex(parsed.data.slideIndex),
      runtimeMode: runtimeModeRaw,
      severity: parsed.data.severity ?? 'error',
      message,
      source: sanitizeRuntimeErrorText(parsed.data.source, MAX_SOURCE_LENGTH) || null,
      stack: sanitizeRuntimeErrorText(parsed.data.stack, MAX_STACK_LENGTH) || null,
      requestId: parsed.data.requestId?.trim() || null,
      repairContext,
    },
  }
}

export function createRuntimeErrorStore(limit = DEFAULT_STORE_LIMIT): RuntimeErrorStore {
  const records: RuntimeErrorRecord[] = []

  const record = (input: RuntimeErrorInput): RuntimeErrorRecord => {
    const entry: RuntimeErrorRecord = {
      id: randomUUID(),
      deckId: input.deckId ?? null,
      documentRevision: input.documentRevision ?? null,
      slideIndex: input.slideIndex ?? null,
      runtimeMode: input.runtimeMode ?? null,
      severity: input.severity ?? 'error',
      message: sanitizeRuntimeErrorText(input.message, MAX_MESSAGE_LENGTH),
      source: sanitizeRuntimeErrorText(input.source, MAX_SOURCE_LENGTH) || null,
      stack: sanitizeRuntimeErrorText(input.stack, MAX_STACK_LENGTH) || null,
      requestId: input.requestId ?? null,
      repairContext: input.repairContext ?? null,
      createdAt: new Date().toISOString(),
    }

    records.unshift(entry)

    if (records.length > limit) {
      records.length = limit
    }

    return entry
  }

  const listRecent = (requestedLimit = 50) => {
    const bounded = Math.max(1, Math.min(requestedLimit, 200))
    return records.slice(0, bounded)
  }

  const listForDeck = (deckId: string, requestedLimit = 50) => {
    const bounded = Math.max(1, Math.min(requestedLimit, 200))
    return records.filter((entry) => entry.deckId === deckId).slice(0, bounded)
  }

  return {
    record,
    listRecent,
    listForDeck,
  }
}
