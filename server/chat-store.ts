import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { createPostgresChatStore } from './db/repositories/chat.ts'
import {
  type AppendChatMessageInput,
  type ChatStore,
  type ChatThread,
  type ListChatMessagesOptions,
  type ListChatMessagesResult,
  type StoredChatMessage,
  isValidChatMessageId,
  normalizeChatMessageLimit,
} from './chat-record.ts'
import { isValidDeckId } from './deck-record.ts'

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data', 'chat')

type StoredChatFile = {
  thread: ChatThread
  messages: StoredChatMessage[]
}

function resolveChatPath(dataDir: string, deckId: string) {
  if (!isValidDeckId(deckId)) {
    return null
  }

  const resolvedDataDir = path.resolve(dataDir)
  const resolvedPath = path.resolve(resolvedDataDir, `${deckId}.json`)
  const dataDirPrefix = resolvedDataDir.endsWith(path.sep)
    ? resolvedDataDir
    : `${resolvedDataDir}${path.sep}`

  if (!resolvedPath.startsWith(dataDirPrefix)) {
    return null
  }

  return resolvedPath
}

async function ensureDataDir(dataDir: string) {
  await mkdir(dataDir, { recursive: true })
}

function parseStoredChatFile(parsed: unknown): StoredChatFile | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Partial<StoredChatFile>

  if (
    !record.thread ||
    typeof record.thread !== 'object' ||
    !Array.isArray(record.messages) ||
    typeof record.thread.id !== 'string' ||
    typeof record.thread.deckId !== 'string'
  ) {
    return null
  }

  return {
    thread: record.thread,
    messages: record.messages.filter(
      (message): message is StoredChatMessage =>
        typeof message === 'object' &&
        message !== null &&
        typeof message.id === 'string' &&
        typeof message.content === 'string' &&
        (message.role === 'user' || message.role === 'assistant'),
    ),
  }
}

async function readChatFile(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseStoredChatFile(JSON.parse(raw))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    return null
  }
}

async function writeChatFile(filePath: string, file: StoredChatFile) {
  await writeFile(filePath, JSON.stringify(file, null, 2), 'utf8')
}

export function createChatStore(dataDir = DEFAULT_DATA_DIR): ChatStore {
  const getActiveThread = async (deckId: string) => {
    const filePath = resolveChatPath(dataDir, deckId)

    if (!filePath) {
      return null
    }

    const file = await readChatFile(filePath)

    return file?.thread.status === 'active' ? file.thread : null
  }

  const getOrCreateActiveThread = async (
    deckId: string,
    activeDeckVersionId: string | null = null,
  ) => {
    const filePath = resolveChatPath(dataDir, deckId)

    if (!filePath) {
      throw new Error('Invalid deck id.')
    }

    await ensureDataDir(dataDir)

    const existing = await readChatFile(filePath)

    if (existing?.thread.status === 'active') {
      const thread = {
        ...existing.thread,
        activeDeckVersionId: activeDeckVersionId ?? existing.thread.activeDeckVersionId,
        updatedAt: new Date().toISOString(),
      }

      await writeChatFile(filePath, {
        thread,
        messages: existing.messages,
      })

      return thread
    }

    const now = new Date().toISOString()
    const thread: ChatThread = {
      id: randomUUID(),
      deckId,
      activeDeckVersionId,
      title: 'Deck chat',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    await writeChatFile(filePath, {
      thread,
      messages: [],
    })

    return thread
  }

  const listMessages = async (
    deckId: string,
    options: ListChatMessagesOptions = {},
  ): Promise<ListChatMessagesResult> => {
    const filePath = resolveChatPath(dataDir, deckId)

    if (!filePath) {
      return { thread: null, messages: [], hasMore: false }
    }

    const file = await readChatFile(filePath)

    if (!file || file.thread.status !== 'active') {
      return { thread: null, messages: [], hasMore: false }
    }

    const limit = normalizeChatMessageLimit(options.limit)
    const before = options.before?.trim() ?? null
    let messages = [...file.messages].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )

    if (before && isValidChatMessageId(before)) {
      const beforeIndex = messages.findIndex((message) => message.id === before)

      if (beforeIndex > 0) {
        messages = messages.slice(0, beforeIndex)
      } else if (beforeIndex === 0) {
        messages = []
      }
    }

    const hasMore = messages.length > limit
    const page = hasMore ? messages.slice(messages.length - limit) : messages

    return {
      thread: file.thread,
      messages: page,
      hasMore,
    }
  }

  const appendMessage = async (deckId: string, input: AppendChatMessageInput) => {
    const filePath = resolveChatPath(dataDir, deckId)

    if (!filePath) {
      throw new Error('Invalid deck id.')
    }

    await ensureDataDir(dataDir)

    const existing = await readChatFile(filePath)
    const thread =
      existing?.thread.status === 'active'
        ? existing.thread
        : await getOrCreateActiveThread(deckId, input.deckVersionId ?? null)
    const messages = existing?.thread.status === 'active' ? [...existing.messages] : []
    const id = input.id && isValidChatMessageId(input.id) ? input.id : randomUUID()
    const duplicate = messages.find((message) => message.id === id)

    if (duplicate) {
      return duplicate
    }

    const createdAt = new Date().toISOString()
    const message: StoredChatMessage = {
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
      createdAt,
    }

    await writeChatFile(filePath, {
      thread: {
        ...thread,
        activeDeckVersionId: input.deckVersionId ?? thread.activeDeckVersionId,
        updatedAt: createdAt,
      },
      messages: [...messages, message],
    })

    return message
  }

  const clearThread = async (deckId: string) => {
    const filePath = resolveChatPath(dataDir, deckId)

    if (!filePath) {
      return false
    }

    try {
      await unlink(filePath)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return false
      }

      throw error
    }
  }

  return {
    getOrCreateActiveThread,
    getActiveThread,
    listMessages,
    appendMessage,
    clearThread,
  }
}

export function createDefaultChatStore(env = process.env): ChatStore {
  if (env.DATABASE_URL?.trim()) {
    return createPostgresChatStore()
  }

  return createChatStore()
}

export const chatStore = createDefaultChatStore()
