import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import {
  type AppendChatMessageInput,
  type ChatStore,
  type ChatThread,
  type ListChatMessagesOptions,
  assertValidDeckIdForChat,
} from '../records/chat-record.ts'
import { appendChatMessage, listChatMessages } from './chat-store-messages.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

function activeThread(database: DatabaseSync, deckId: string, revision: number): ChatThread | null {
  const row = database
    .prepare(
      `SELECT id, title, visibility, created_at, updated_at, archived_at
       FROM threads WHERE archived_at IS NULL ORDER BY created_at LIMIT 1`,
    )
    .get() as
    | {
        id: string
        title: string
        visibility: 'private' | 'shared'
        created_at: string
        updated_at: string
        archived_at: string | null
      }
    | undefined
  return row
    ? {
        id: row.id,
        deckId,
        activeDocumentRevision: revision,
        title: row.title,
        status: row.archived_at ? 'archived' : 'active',
        visibility: row.visibility,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null
}

function deleteThreadWithAttachments(database: DatabaseSync, threadId: string) {
  const assetIds = (
    database
      .prepare(
        `SELECT DISTINCT asset_id FROM asset_references
         WHERE owner_type = 'message'
         AND owner_id IN (SELECT id FROM messages WHERE thread_id = ?)`,
      )
      .all(threadId) as Array<{ asset_id: string }>
  ).map((row) => row.asset_id)

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `DELETE FROM asset_references WHERE owner_type = 'message'
         AND owner_id IN (SELECT id FROM messages WHERE thread_id = ?)`,
      )
      .run(threadId)
    const deleted = database.prepare('DELETE FROM threads WHERE id = ?').run(threadId).changes > 0
    const deleteAsset = database.prepare(
      `DELETE FROM assets WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM asset_references WHERE asset_id = ?)`,
    )
    for (const assetId of assetIds) deleteAsset.run(assetId, assetId)
    database
      .prepare(
        `DELETE FROM blobs
         WHERE NOT EXISTS (SELECT 1 FROM assets WHERE blob_checksum = blobs.checksum)`,
      )
      .run()
    database.exec('COMMIT')
    return deleted
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function updateStoredThread(
  database: DatabaseSync,
  existing: ChatThread,
  patch: { title?: string; visibility?: ChatThread['visibility']; archived?: boolean },
  threadId: string,
) {
  const now = new Date().toISOString()
  database
    .prepare(
      'UPDATE threads SET title = ?, visibility = ?, archived_at = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      patch.title?.trim() || existing.title,
      patch.visibility ?? existing.visibility,
      patch.archived === true
        ? now
        : patch.archived === false
          ? null
          : existing.status === 'archived'
            ? existing.updatedAt
            : null,
      now,
      threadId,
    )
}

export function createChatStore(
  workspaceOrDirectory: WorkspaceStore | string = createWorkspaceStore(),
): ChatStore {
  const workspaces =
    typeof workspaceOrDirectory === 'string'
      ? createWorkspaceStore(workspaceOrDirectory)
      : workspaceOrDirectory

  const context = async (deckId: string) => {
    assertValidDeckIdForChat(deckId)
    const [database, workspace] = await Promise.all([
      workspaces.database(deckId),
      workspaces.get(deckId),
    ])
    if (!database || !workspace) throw new Error('Deck not found.')
    return { database, workspace }
  }

  const getActiveThread = async (deckId: string) => {
    const { database, workspace } = await context(deckId)
    return activeThread(database, deckId, workspace.documentRevision)
  }

  const listThreads = async (deckId: string) => {
    const { database, workspace } = await context(deckId)
    const rows = database
      .prepare(
        'SELECT id, title, visibility, created_at, updated_at, archived_at FROM threads ORDER BY updated_at DESC',
      )
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      deckId,
      activeDocumentRevision: workspace.documentRevision,
      title: String(row.title),
      status: row.archived_at ? ('archived' as const) : ('active' as const),
      visibility: row.visibility === 'shared' ? ('shared' as const) : ('private' as const),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }))
  }

  const createThread = async (deckId: string, title = 'Chat') => {
    const { database, workspace } = await context(deckId)
    const id = randomUUID()
    const now = new Date().toISOString()
    database
      .prepare(
        `INSERT INTO threads (id, title, visibility, created_at, updated_at) VALUES (?, ?, 'private', ?, ?)`,
      )
      .run(id, title.trim() || 'Chat', now, now)
    return (
      (await listThreads(deckId)).find((thread) => thread.id === id) ?? {
        id,
        deckId,
        activeDocumentRevision: workspace.documentRevision,
        title,
        status: 'active',
        visibility: 'private',
        createdAt: now,
        updatedAt: now,
      }
    )
  }

  const updateThread: ChatStore['updateThread'] = async (deckId, threadId, patch) => {
    const { database } = await context(deckId)
    const existing = (await listThreads(deckId)).find((thread) => thread.id === threadId)
    if (!existing) return null
    updateStoredThread(database, existing, patch, threadId)
    return (await listThreads(deckId)).find((thread) => thread.id === threadId) ?? null
  }

  const deleteThread = async (deckId: string, threadId: string) => {
    const { database } = await context(deckId)
    return deleteThreadWithAttachments(database, threadId)
  }

  const getOrCreateActiveThread = async (deckId: string) => {
    const { database, workspace } = await context(deckId)
    const existing = activeThread(database, deckId, workspace.documentRevision)
    if (existing) return existing
    const id = randomUUID()
    const now = new Date().toISOString()
    database
      .prepare(
        `INSERT INTO threads
         (id, title, visibility, created_at, updated_at) VALUES (?, 'Chat', 'private', ?, ?)`,
      )
      .run(id, now, now)
    return activeThread(database, deckId, workspace.documentRevision)!
  }

  const listMessages = async (deckId: string, options: ListChatMessagesOptions = {}) =>
    listChatMessages(context, activeThread, deckId, options)

  const appendMessage = async (deckId: string, input: AppendChatMessageInput) =>
    appendChatMessage(context, getOrCreateActiveThread, deckId, input)

  const clearThread = async (deckId: string) => {
    const { database, workspace } = await context(deckId)
    const thread = activeThread(database, deckId, workspace.documentRevision)
    if (!thread) return false
    return deleteThreadWithAttachments(database, thread.id)
  }

  return {
    listThreads,
    createThread,
    updateThread,
    deleteThread,
    getOrCreateActiveThread,
    getActiveThread,
    listMessages,
    appendMessage,
    clearThread,
  }
}
