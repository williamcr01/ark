import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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
import { REPO_ROOT } from './repo-root.ts'

const DEFAULT_DATA_DIR = path.resolve(REPO_ROOT, 'data', 'chat')

type StoredChatFile = {
  thread: ChatThread
  messages: StoredChatMessage[]
}

const deckLocks = new Map<string, Promise<void>>()

async function withDeckLock<T>(deckId: string, operation: () => Promise<T>) {
  const previous = deckLocks.get(deckId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const current = previous.then(() => gate)
  deckLocks.set(deckId, current)

  await previous

  try {
    return await operation()
  } finally {
    release()
    if (deckLocks.get(deckId) === current) {
      deckLocks.delete(deckId)
    }
  }
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
    const parsed = parseStoredChatFile(JSON.parse(raw))

    if (!parsed) {
      throw new Error(`Corrupt chat history file at ${filePath}`)
    }

    return parsed
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    if (error instanceof Error && error.message.startsWith('Corrupt chat history file')) {
      throw error
    }

    const corruptError = new Error(`Corrupt chat history file at ${filePath}`, {
      cause: error,
    })
    throw corruptError
  }
}

async function writeChatFile(filePath: string, file: StoredChatFile) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(file, null, 2), 'utf8')
  await rename(tempPath, filePath)
}

export function createChatStore(dataDir = DEFAULT_DATA_DIR): ChatStore {
  const getOrCreateActiveThreadUnlocked = async (
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
  ) => withDeckLock(deckId, () => getOrCreateActiveThreadUnlocked(deckId, activeDeckVersionId))

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

  const appendMessage = async (deckId: string, input: AppendChatMessageInput) =>
    withDeckLock(deckId, async () => {
      const filePath = resolveChatPath(dataDir, deckId)

      if (!filePath) {
        throw new Error('Invalid deck id.')
      }

      await ensureDataDir(dataDir)

      const existing = await readChatFile(filePath)
      const thread =
        existing?.thread.status === 'active'
          ? existing.thread
          : await getOrCreateActiveThreadUnlocked(deckId, input.deckVersionId ?? null)
      const messages = existing?.thread.status === 'active' ? [...existing.messages] : []
      const id =
        input.id && isValidChatMessageId(input.id)
          ? input.id
          : input.generationJobId && isValidChatMessageId(input.generationJobId)
            ? input.generationJobId
            : randomUUID()

      const duplicateById = messages.find((message) => message.id === id)
      if (duplicateById) {
        return duplicateById
      }

      if (input.generationJobId) {
        const duplicateByJob = messages.find(
          (message) => message.generationJobId === input.generationJobId,
        )

        if (duplicateByJob) {
          return duplicateByJob
        }
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
        ...(input.context ? { context: input.context } : {}),
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
    })

  const clearThread = async (deckId: string) =>
    withDeckLock(deckId, async () => {
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
    })

  return {
    getOrCreateActiveThread,
    getActiveThread,
    listMessages,
    appendMessage,
    clearThread,
  }
}
