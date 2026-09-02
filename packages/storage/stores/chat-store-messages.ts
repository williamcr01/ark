import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type {
  AppendChatMessageInput,
  ChatThread,
  ListChatMessagesOptions,
  StoredChatMessage,
} from '../records/chat-record.ts'
import { isValidChatMessageId, normalizeChatMessageLimit } from '../records/chat-record.ts'

export type ChatDeckContext = {
  database: DatabaseSync
  workspace: { documentRevision: number }
}

export async function listChatMessages(
  loadContext: (deckId: string) => Promise<ChatDeckContext>,
  activeThread: (database: DatabaseSync, deckId: string, revision: number) => ChatThread | null,
  deckId: string,
  options: ListChatMessagesOptions = {},
) {
  const { database, workspace } = await loadContext(deckId)
  const thread = activeThread(database, deckId, workspace.documentRevision)
  if (!thread) return { thread: null, messages: [], hasMore: false }

  const limit = normalizeChatMessageLimit(options.limit)
  const beforeRow = options.before
    ? (database
        .prepare('SELECT sequence FROM messages WHERE id = ? AND thread_id = ?')
        .get(options.before, thread.id) as { sequence: number } | undefined)
    : undefined
  const rows = database
    .prepare(
      `SELECT content_json FROM messages
         WHERE thread_id = ? AND sequence < ?
         ORDER BY sequence DESC LIMIT ?`,
    )
    .all(thread.id, beforeRow?.sequence ?? Number.MAX_SAFE_INTEGER, limit + 1) as Array<{
    content_json: string
  }>
  const hasMore = rows.length > limit
  const messages = rows
    .slice(0, limit)
    .reverse()
    .map((row) => JSON.parse(row.content_json) as StoredChatMessage)
  return { thread, messages, hasMore }
}

export async function appendChatMessage(
  loadContext: (deckId: string) => Promise<ChatDeckContext>,
  getOrCreateActiveThread: (deckId: string) => Promise<ChatThread>,
  deckId: string,
  input: AppendChatMessageInput,
) {
  const { database, workspace } = await loadContext(deckId)
  const thread = await getOrCreateActiveThread(deckId)
  const id = input.id ?? randomUUID()
  if (!isValidChatMessageId(id)) throw new Error('Invalid chat message id.')
  const existing = database.prepare('SELECT content_json FROM messages WHERE id = ?').get(id) as
    { content_json: string } | undefined
  if (existing) return JSON.parse(existing.content_json) as StoredChatMessage
  const now = new Date().toISOString()
  const message: StoredChatMessage = {
    ...input,
    id,
    threadId: thread.id,
    deckId,
    documentRevision: workspace.documentRevision,
    createdAt: now,
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    const sequence = (
      database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM messages WHERE thread_id = ?',
        )
        .get(thread.id) as { sequence: number }
    ).sequence
    database
      .prepare(
        `INSERT INTO messages
           (id, thread_id, sequence, role, content_json, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, thread.id, sequence, input.role, JSON.stringify(message), input.model ?? null, now)
    for (const assetId of new Set(input.attachments?.flatMap((item) => item.assetId ?? []) ?? [])) {
      if (!database.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)) {
        throw new Error(`Unknown attachment asset: ${assetId}`)
      }
      database
        .prepare(
          `INSERT OR IGNORE INTO asset_references
             (asset_id, owner_type, owner_id, purpose)
             VALUES (?, 'message', ?, 'attachment')`,
        )
        .run(assetId, id)
    }
    database.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(now, thread.id)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return message
}
