import { randomUUID } from 'node:crypto'

import type { ChatAttachment, ChatMessagePart } from '@ark/deck-core/chat.ts'
import { createPostgresPool, type ConnectablePool } from '../client.ts'
import { runMigrations } from '../migrate.ts'
import { isValidDeckId } from '../../deck-record.ts'
import {
  type AppendChatMessageInput,
  type ChatStore,
  type ChatThread,
  type ChatThreadStatus,
  type ListChatMessagesOptions,
  type ListChatMessagesResult,
  type StoredChatMessage,
  type StoredChatMessageError,
  isValidChatMessageId,
  normalizeChatMessageLimit,
} from '../../chat-record.ts'
import { DEFAULT_WORKSPACE_ID } from './decks.ts'

type ChatThreadRow = {
  id: string
  deck_id: string
  workspace_id: string
  active_deck_version_id: string | null
  title: string
  status: string
  created_at: Date | string
  updated_at: Date | string
}

type ChatMessageRow = {
  id: string
  thread_id: string
  deck_id: string
  deck_version_id: string | null
  role: string
  content_summary: string
  tool_activity: unknown
  attachments_metadata: unknown
  generation_status: string | null
  message_metadata: Record<string, unknown> | null
  error_metadata: Record<string, unknown> | null
  created_at: Date | string
}

type PostgresChatStoreOptions = {
  pool?: ConnectablePool
  migrate?: boolean
  now?: () => Date
  defaultWorkspaceId?: string
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function readToolActivity(value: unknown): ChatMessagePart[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  return value as ChatMessagePart[]
}

function readAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  return value as ChatAttachment[]
}

function readErrorMetadata(
  metadata: Record<string, unknown> | null,
): StoredChatMessageError | null {
  if (!metadata || typeof metadata.message !== 'string') {
    return null
  }

  return {
    message: metadata.message,
    code: typeof metadata.code === 'string' ? metadata.code : null,
  }
}

function readMessageMetadata(
  messageMetadata: Record<string, unknown> | null,
  errorMetadata: Record<string, unknown> | null,
) {
  const metadata = {
    ...(errorMetadata ?? {}),
    ...(messageMetadata ?? {}),
  }

  return {
    generationJobId: typeof metadata.generationJobId === 'string' ? metadata.generationJobId : null,
    model: typeof metadata.model === 'string' ? metadata.model : null,
    context:
      metadata.context && typeof metadata.context === 'object' && !Array.isArray(metadata.context)
        ? (metadata.context as import('@ark/deck-core/chat.ts').ChatMessageContext)
        : undefined,
  }
}

function mapThread(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    deckId: row.deck_id,
    activeDeckVersionId: row.active_deck_version_id,
    title: row.title,
    status: row.status as ChatThreadStatus,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function mapMessage(row: ChatMessageRow): StoredChatMessage {
  const messageMetadata = row.message_metadata ?? {}
  const errorMetadata = row.error_metadata ?? {}
  const { generationJobId, model, context } = readMessageMetadata(messageMetadata, errorMetadata)
  const error = readErrorMetadata(errorMetadata)

  return {
    id: row.id,
    threadId: row.thread_id,
    deckId: row.deck_id,
    deckVersionId: row.deck_version_id,
    role: row.role as 'user' | 'assistant',
    content: row.content_summary,
    parts: readToolActivity(row.tool_activity),
    attachments: readAttachments(row.attachments_metadata),
    ...(context ? { context } : {}),
    generationJobId,
    generationStatus: row.generation_status,
    model,
    error,
    createdAt: toIsoString(row.created_at),
  }
}

function buildMessageMetadata(input: AppendChatMessageInput) {
  const metadata: Record<string, unknown> = {}

  if (input.generationJobId) {
    metadata.generationJobId = input.generationJobId
  }

  if (input.model) {
    metadata.model = input.model
  }

  if (input.context) {
    metadata.context = input.context
  }

  return metadata
}

function buildErrorMetadata(input: AppendChatMessageInput) {
  if (!input.error) {
    return {}
  }

  return {
    message: input.error.message,
    code: input.error.code ?? null,
  }
}

export function createPostgresChatStore(options: PostgresChatStoreOptions = {}): ChatStore {
  const pool = options.pool ?? createPostgresPool()
  const now = options.now ?? (() => new Date())
  const defaultWorkspaceId = options.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID
  let migrated = false

  const ensureMigrated = async () => {
    if (migrated || options.migrate === false) {
      return
    }

    await runMigrations(pool)
    migrated = true
  }

  const deckExists = async (deckId: string) => {
    const result = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM decks
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [deckId],
    )

    return Boolean(result.rows[0])
  }

  const getActiveThread = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return null
    }

    await ensureMigrated()

    const result = await pool.query<ChatThreadRow>(
      `
        SELECT
          id,
          deck_id,
          workspace_id,
          active_deck_version_id,
          title,
          status,
          created_at,
          updated_at
        FROM chat_threads
        WHERE deck_id = $1
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [deckId],
    )

    const row = result.rows[0]
    return row ? mapThread(row) : null
  }

  const getOrCreateActiveThread = async (
    deckId: string,
    activeDeckVersionId: string | null = null,
  ) => {
    if (!isValidDeckId(deckId)) {
      throw new Error('Invalid deck id.')
    }

    await ensureMigrated()

    if (!(await deckExists(deckId))) {
      throw new Error('Deck not found.')
    }

    const existing = await getActiveThread(deckId)

    if (existing) {
      if (activeDeckVersionId && existing.activeDeckVersionId !== activeDeckVersionId) {
        const timestamp = now()

        await pool.query(
          `
            UPDATE chat_threads
            SET
              active_deck_version_id = $2,
              updated_at = $3
            WHERE id = $1
          `,
          [existing.id, activeDeckVersionId, timestamp],
        )

        return {
          ...existing,
          activeDeckVersionId,
          updatedAt: toIsoString(timestamp),
        }
      }

      return existing
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `
          SELECT id
          FROM decks
          WHERE id = $1
            AND deleted_at IS NULL
          FOR UPDATE
        `,
        [deckId],
      )

      const lockedExisting = await client.query<ChatThreadRow>(
        `
          SELECT
            id,
            deck_id,
            workspace_id,
            active_deck_version_id,
            title,
            status,
            created_at,
            updated_at
          FROM chat_threads
          WHERE deck_id = $1
            AND status = 'active'
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [deckId],
      )

      if (lockedExisting.rows[0]) {
        await client.query('COMMIT')
        return mapThread(lockedExisting.rows[0])
      }

      const id = randomUUID()
      const timestamp = now()

      const workspaceResult = await client.query<{ workspace_id: string }>(
        'SELECT workspace_id FROM decks WHERE id = $1',
        [deckId],
      )
      const workspaceId = workspaceResult.rows[0]?.workspace_id ?? defaultWorkspaceId

      const inserted = await client.query<ChatThreadRow>(
        `
          INSERT INTO chat_threads (
            id,
            deck_id,
            workspace_id,
            active_deck_version_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $5)
          RETURNING
            id,
            deck_id,
            workspace_id,
            active_deck_version_id,
            title,
            status,
            created_at,
            updated_at
        `,
        [id, deckId, workspaceId, activeDeckVersionId, timestamp],
      )

      await client.query('COMMIT')
      return mapThread(inserted.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  const listMessages = async (
    deckId: string,
    options: ListChatMessagesOptions = {},
  ): Promise<ListChatMessagesResult> => {
    if (!isValidDeckId(deckId)) {
      return { thread: null, messages: [], hasMore: false }
    }

    await ensureMigrated()

    const thread = await getActiveThread(deckId)

    if (!thread) {
      return { thread: null, messages: [], hasMore: false }
    }

    const limit = normalizeChatMessageLimit(options.limit)
    const before = options.before?.trim() ?? null

    if (before && !isValidChatMessageId(before)) {
      return { thread, messages: [], hasMore: false }
    }

    const params: unknown[] = [thread.id, limit + 1]
    let beforeClause = ''

    if (before) {
      beforeClause = `
        AND created_at < (
          SELECT created_at
          FROM chat_messages
          WHERE id = $3
            AND thread_id = $1
        )
      `
      params.push(before)
    }

    const result = await pool.query<ChatMessageRow>(
      `
        SELECT
          id,
          thread_id,
          deck_id,
          deck_version_id,
          role,
          content_summary,
          tool_activity,
          attachments_metadata,
          generation_status,
          message_metadata,
          error_metadata,
          created_at
        FROM chat_messages
        WHERE thread_id = $1
          ${beforeClause}
        ORDER BY created_at DESC
        LIMIT $2
      `,
      params,
    )

    const hasMore = result.rows.length > limit
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows

    return {
      thread,
      messages: rows.reverse().map(mapMessage),
      hasMore,
    }
  }

  const appendMessage = async (deckId: string, input: AppendChatMessageInput) => {
    if (!isValidDeckId(deckId)) {
      throw new Error('Invalid deck id.')
    }

    await ensureMigrated()

    const thread = await getOrCreateActiveThread(deckId, input.deckVersionId ?? null)
    const id =
      input.id && isValidChatMessageId(input.id)
        ? input.id
        : input.generationJobId && isValidChatMessageId(input.generationJobId)
          ? input.generationJobId
          : randomUUID()
    const timestamp = now()

    if (input.generationJobId) {
      const existingByJob = await pool.query<ChatMessageRow>(
        `
          SELECT
            id,
            thread_id,
            deck_id,
            deck_version_id,
            role,
            content_summary,
            tool_activity,
            attachments_metadata,
            generation_status,
            message_metadata,
            error_metadata,
            created_at
          FROM chat_messages
          WHERE deck_id = $1
            AND message_metadata->>'generationJobId' = $2
        `,
        [deckId, input.generationJobId],
      )

      if (existingByJob.rows[0]) {
        return mapMessage(existingByJob.rows[0])
      }
    }

    if (input.id && isValidChatMessageId(input.id)) {
      const existing = await pool.query<ChatMessageRow>(
        `
          SELECT
            id,
            thread_id,
            deck_id,
            deck_version_id,
            role,
            content_summary,
            tool_activity,
            attachments_metadata,
            generation_status,
            error_metadata,
            created_at
          FROM chat_messages
          WHERE id = $1
            AND deck_id = $2
        `,
        [input.id, deckId],
      )

      if (existing.rows[0]) {
        return mapMessage(existing.rows[0])
      }
    }

    await pool.query(
      `
        INSERT INTO chat_messages (
          id,
          thread_id,
          deck_id,
          deck_version_id,
          role,
          content_summary,
          tool_activity,
          attachments_metadata,
          generation_status,
          message_metadata,
          error_metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11::jsonb, $12)
      `,
      [
        id,
        thread.id,
        deckId,
        input.deckVersionId ?? thread.activeDeckVersionId,
        input.role,
        input.content,
        JSON.stringify(input.parts ?? []),
        JSON.stringify(input.attachments ?? []),
        input.generationStatus ?? null,
        JSON.stringify(buildMessageMetadata(input)),
        JSON.stringify(buildErrorMetadata(input)),
        timestamp,
      ],
    )

    await pool.query(
      `
        UPDATE chat_threads
        SET updated_at = $2
        WHERE id = $1
      `,
      [thread.id, timestamp],
    )

    return {
      id,
      threadId: thread.id,
      deckId,
      deckVersionId: input.deckVersionId ?? thread.activeDeckVersionId,
      role: input.role,
      content: input.content,
      parts: input.parts,
      attachments: input.attachments,
      generationJobId: input.generationJobId ?? null,
      generationStatus: input.generationStatus ?? null,
      model: input.model ?? null,
      error: input.error ?? null,
      createdAt: toIsoString(timestamp),
    }
  }

  const clearThread = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return false
    }

    await ensureMigrated()

    const thread = await getActiveThread(deckId)

    if (!thread) {
      return false
    }

    const timestamp = now()

    await pool.query('DELETE FROM chat_messages WHERE thread_id = $1', [thread.id])
    await pool.query(
      `
        UPDATE chat_threads
        SET
          status = 'archived',
          updated_at = $2
        WHERE id = $1
      `,
      [thread.id, timestamp],
    )

    return true
  }

  return {
    getOrCreateActiveThread,
    getActiveThread,
    listMessages,
    appendMessage,
    clearThread,
  }
}
