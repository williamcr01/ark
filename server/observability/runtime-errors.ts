import { randomUUID } from 'node:crypto'

import { isValidDeckId } from '../deck-record.ts'
import { sanitizeRuntimeErrorText } from './redact.ts'

export type RuntimeErrorSeverity = 'info' | 'warning' | 'error'

export type RuntimeErrorRecord = {
  id: string
  deckId: string | null
  versionId: string | null
  slideIndex: number | null
  runtimeMode: string | null
  severity: RuntimeErrorSeverity
  message: string
  source: string | null
  stack: string | null
  requestId: string | null
  createdAt: string
}

export type RuntimeErrorInput = {
  deckId?: string | null
  versionId?: string | null
  slideIndex?: number | null
  runtimeMode?: string | null
  severity?: RuntimeErrorSeverity | null
  message: string
  source?: string | null
  stack?: string | null
  requestId?: string | null
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

function normalizeSeverity(value: unknown): RuntimeErrorSeverity {
  if (value === 'info' || value === 'warning' || value === 'error') {
    return value
  }

  return 'error'
}

export function parseRuntimeErrorBody(
  body: unknown,
): { ok: true; input: RuntimeErrorInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' }
  }

  const record = body as Record<string, unknown>
  const message = sanitizeRuntimeErrorText(record.message, MAX_MESSAGE_LENGTH)

  if (!message) {
    return { ok: false, error: 'message is required.' }
  }

  const deckId = typeof record.deckId === 'string' ? record.deckId.trim() : null

  if (deckId && !isValidDeckId(deckId)) {
    return { ok: false, error: 'Invalid deck id.' }
  }

  const versionId = typeof record.versionId === 'string' ? record.versionId.trim() : null

  if (versionId && !isValidDeckId(versionId)) {
    return { ok: false, error: 'Invalid version id.' }
  }

  const runtimeModeRaw =
    typeof record.runtimeMode === 'string'
      ? record.runtimeMode.trim().slice(0, MAX_RUNTIME_MODE_LENGTH)
      : null

  return {
    ok: true,
    input: {
      deckId: deckId || null,
      versionId: versionId || null,
      slideIndex: clampSlideIndex(record.slideIndex),
      runtimeMode: runtimeModeRaw || null,
      severity: normalizeSeverity(record.severity),
      message,
      source: sanitizeRuntimeErrorText(record.source, MAX_SOURCE_LENGTH) || null,
      stack: sanitizeRuntimeErrorText(record.stack, MAX_STACK_LENGTH) || null,
      requestId:
        typeof record.requestId === 'string' && record.requestId.trim()
          ? record.requestId.trim()
          : null,
    },
  }
}

export function createRuntimeErrorStore(limit = DEFAULT_STORE_LIMIT): RuntimeErrorStore {
  const records: RuntimeErrorRecord[] = []

  const record = (input: RuntimeErrorInput): RuntimeErrorRecord => {
    const entry: RuntimeErrorRecord = {
      id: randomUUID(),
      deckId: input.deckId ?? null,
      versionId: input.versionId ?? null,
      slideIndex: input.slideIndex ?? null,
      runtimeMode: input.runtimeMode ?? null,
      severity: input.severity ?? 'error',
      message: sanitizeRuntimeErrorText(input.message, MAX_MESSAGE_LENGTH),
      source: sanitizeRuntimeErrorText(input.source, MAX_SOURCE_LENGTH) || null,
      stack: sanitizeRuntimeErrorText(input.stack, MAX_STACK_LENGTH) || null,
      requestId: input.requestId ?? null,
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
