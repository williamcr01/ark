import { randomUUID } from 'node:crypto'

import type {
  McpInteractionAnswer,
  McpInteractionChanged,
  McpPendingInteraction,
} from '@ark/contracts'

const INTERACTION_TTL_MS = 30 * 60 * 1_000
const TERMINAL_RETENTION_MS = 5 * 60 * 1_000
const MAX_WAIT_MS = 20_000

type InteractionStatus = 'pending' | 'answered' | 'canceled' | 'stale' | 'expired'

type InteractionRecord = {
  interaction: McpPendingInteraction
  clientSessionId: string
  status: InteractionStatus
  answer?: McpInteractionAnswer
  reason?: string
  waiters: Set<() => void>
  expiryTimer?: ReturnType<typeof setTimeout>
  cleanupTimer?: ReturnType<typeof setTimeout>
}

export type McpInteractionResult = {
  interactionId: string
  status: InteractionStatus
  answer?: McpInteractionAnswer
  reason?: string
}

export class McpInteractionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'McpInteractionError'
    this.code = code
  }
}

export class McpInteractionStore {
  private readonly records = new Map<string, InteractionRecord>()
  private pendingId: string | null = null
  private readonly onChanged?: (change: McpInteractionChanged) => void

  constructor(onChanged?: (change: McpInteractionChanged) => void) {
    this.onChanged = onChanged
  }

  private expire(record: InteractionRecord) {
    if (record.status === 'pending' && Date.parse(record.interaction.expiresAt) <= Date.now()) {
      this.finish(record, 'expired', undefined, 'The interaction expired before the user answered.')
    }
  }

  private finish(
    record: InteractionRecord,
    status: Exclude<InteractionStatus, 'pending'>,
    answer?: McpInteractionAnswer,
    reason?: string,
  ) {
    if (record.status !== 'pending') return
    record.status = status
    record.answer = answer
    record.reason = reason
    clearTimeout(record.expiryTimer)
    if (this.pendingId === record.interaction.id) {
      this.pendingId = null
      this.onChanged?.({ interaction: null })
    }
    for (const resolve of record.waiters) resolve()
    record.waiters.clear()
    record.cleanupTimer = setTimeout(
      () => this.records.delete(record.interaction.id),
      TERMINAL_RETENTION_MS,
    )
    record.cleanupTimer.unref?.()
  }

  getPending() {
    const record = this.pendingId ? this.records.get(this.pendingId) : undefined
    if (!record) return null
    this.expire(record)
    return record.status === 'pending' ? record.interaction : null
  }

  create(
    input: Omit<McpPendingInteraction, 'id' | 'createdAt' | 'expiresAt'>,
    clientSessionId: string,
  ) {
    const pending = this.getPending()
    if (pending) {
      throw new McpInteractionError(
        'INTERACTION_PENDING',
        'Ark is already waiting for a response to another MCP interaction.',
      )
    }

    const createdAt = new Date()
    const interaction = {
      ...input,
      id: randomUUID(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + INTERACTION_TTL_MS).toISOString(),
    } as McpPendingInteraction
    const record: InteractionRecord = {
      interaction,
      clientSessionId,
      status: 'pending',
      waiters: new Set(),
    }
    this.records.set(interaction.id, record)
    record.expiryTimer = setTimeout(
      () =>
        this.finish(
          record,
          'expired',
          undefined,
          'The interaction expired before the user answered.',
        ),
      INTERACTION_TTL_MS,
    )
    record.expiryTimer.unref?.()
    this.pendingId = interaction.id
    this.onChanged?.({ interaction })
    return interaction
  }

  respond(id: string, answer: McpInteractionAnswer) {
    const record = this.records.get(id)
    if (!record || record.status !== 'pending') {
      throw new McpInteractionError(
        'INTERACTION_NOT_PENDING',
        'That interaction is no longer pending.',
      )
    }
    if (record.interaction.kind !== answer.kind) {
      throw new McpInteractionError('INVALID_INTERACTION_RESPONSE', 'Response type does not match.')
    }
    if (answer.kind === 'themes') {
      if ('refresh' in answer && answer.refresh) {
        this.finish(record, 'answered', answer)
        return
      }
      const request = record.interaction.kind === 'themes' ? record.interaction.request : null
      if (!('themeId' in answer) || !request?.themes.some((theme) => theme.id === answer.themeId)) {
        throw new McpInteractionError('INVALID_INTERACTION_RESPONSE', 'Unknown theme choice.')
      }
    } else {
      const request = record.interaction.kind === 'questions' ? record.interaction.request : null
      const knownIds = new Set(request?.questions.map((question) => question.id))
      if (Object.keys(answer.answers).some((questionId) => !knownIds.has(questionId))) {
        throw new McpInteractionError('INVALID_INTERACTION_RESPONSE', 'Unknown question answer.')
      }
    }
    this.finish(record, 'answered', answer)
  }

  cancel(id: string, reason = 'The user canceled the interaction.') {
    const record = this.records.get(id)
    if (!record || record.status !== 'pending') return false
    this.finish(record, 'canceled', undefined, reason)
    return true
  }

  cancelForTarget(deckId: string | null, documentRevision: number | null) {
    const record = this.pendingId ? this.records.get(this.pendingId) : undefined
    if (!record) return
    if (
      record.interaction.deckId !== deckId ||
      record.interaction.baseDocumentRevision !== documentRevision
    ) {
      this.finish(
        record,
        'stale',
        undefined,
        'The active deck or document revision changed before the user answered.',
      )
    }
  }

  cancelAll(reason = 'MCP was stopped before the user answered.') {
    for (const record of this.records.values()) {
      this.finish(record, 'canceled', undefined, reason)
    }
  }

  async wait(id: string, clientSessionId: string, timeoutMs = MAX_WAIT_MS) {
    const record = this.records.get(id)
    if (!record) {
      throw new McpInteractionError('INTERACTION_NOT_FOUND', 'Unknown or expired interaction.')
    }
    if (record.clientSessionId !== clientSessionId) {
      throw new McpInteractionError(
        'INTERACTION_NOT_OWNED',
        'That interaction belongs to another MCP client session.',
      )
    }
    this.expire(record)
    const waitMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.trunc(timeoutMs)))
    if (record.status === 'pending' && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          record.waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, waitMs)
        record.waiters.add(done)
      })
      this.expire(record)
    }
    return {
      interactionId: id,
      status: record.status,
      ...(record.answer ? { answer: record.answer } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
    } satisfies McpInteractionResult
  }
}

export function createMcpInteractionStore(onChanged?: (change: McpInteractionChanged) => void) {
  return new McpInteractionStore(onChanged)
}
