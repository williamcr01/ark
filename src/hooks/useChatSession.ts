import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatMessage } from '../../shared/chat.ts'
import { persistedMessageToChatMessage } from '../../shared/chat-thread.ts'
import { appendDeckChatMessage, clearDeckChat, fetchAllDeckChat } from '@/lib/chat-api'
import { reconcileChatMessages } from '@/lib/chat-reconcile'
import {
  clearChatSession,
  createChatSession,
  readChatSession,
  writeChatSession,
} from '@/lib/chat-session'

export type MessageDeliveryStatus = 'saving' | 'saved' | 'failed'

export type UseChatSessionOptions = {
  deckId: string | null
  deckVersionId?: string | null
  onPersistFailure?: (messageId: string) => void
  onResetFailure?: () => void
  onReloadFallback?: () => void
}

function buildDeliveryStatusMap(
  messages: ChatMessage[],
  failedIds: Set<string>,
  savingIds: Iterable<string> = [],
): Map<string, MessageDeliveryStatus> {
  const status = new Map<string, MessageDeliveryStatus>()

  for (const id of savingIds) {
    status.set(id, 'saving')
  }

  for (const message of messages) {
    if (status.has(message.id)) {
      continue
    }

    status.set(message.id, failedIds.has(message.id) ? 'failed' : 'saved')
  }

  return status
}

export function useChatSession({
  deckId,
  deckVersionId = null,
  onPersistFailure,
  onResetFailure,
  onReloadFallback,
}: UseChatSessionOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => readChatSession(deckId)?.messages ?? createChatSession().messages,
  )
  const [isLoading, setIsLoading] = useState(Boolean(deckId))
  const [failedPersistIds, setFailedPersistIds] = useState<Set<string>>(() => {
    if (!deckId) {
      return new Set()
    }

    return new Set(readChatSession(deckId)?.failedPersistIds ?? [])
  })
  const [deliveryStatus, setDeliveryStatus] = useState<Map<string, MessageDeliveryStatus>>(
    () => new Map(),
  )
  const [isReloadStale, setIsReloadStale] = useState(false)
  const loadRequestIdRef = useRef(0)
  const deckIdRef = useRef(deckId)
  const failedPersistIdsRef = useRef(failedPersistIds)
  const messagesRef = useRef(messages)

  useEffect(() => {
    deckIdRef.current = deckId
  }, [deckId])

  useEffect(() => {
    failedPersistIdsRef.current = failedPersistIds
  }, [failedPersistIds])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const applyReconciledMessages = useCallback(
    (
      localMessages: ChatMessage[],
      serverMessages: ChatMessage[],
      knownFailedIds: Set<string> = failedPersistIdsRef.current,
    ) => {
      const { messages: merged, failedIds } = reconcileChatMessages(
        localMessages,
        serverMessages,
        knownFailedIds,
      )

      setMessages(merged)
      setFailedPersistIds(failedIds)
      setDeliveryStatus(buildDeliveryStatusMap(merged, failedIds))

      return { messages: merged, failedIds }
    },
    [],
  )

  useEffect(() => {
    const requestId = ++loadRequestIdRef.current

    void (async () => {
      setIsLoading(Boolean(deckId))
      setIsReloadStale(false)

      if (!deckId) {
        const localMessages = readChatSession(null)?.messages ?? []

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setMessages(localMessages)
        setFailedPersistIds(new Set())
        setDeliveryStatus(new Map())
        setIsLoading(false)
        return
      }

      const localSession = readChatSession(deckId)
      const localMessages = localSession?.messages ?? []
      const storedFailedIds = new Set(localSession?.failedPersistIds ?? [])

      try {
        const data = await fetchAllDeckChat(deckId)
        const serverMessages = data.messages.map(persistedMessageToChatMessage)

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        const { messages: merged, failedIds } = applyReconciledMessages(
          localMessages,
          serverMessages,
          storedFailedIds,
        )
        writeChatSession(deckId, {
          messages: merged,
          updatedAt: new Date().toISOString(),
          failedPersistIds: [...failedIds],
        })
      } catch {
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        const cachedMessages = readChatSession(deckId)?.messages ?? []
        setMessages(cachedMessages)
        setIsReloadStale(true)
        onReloadFallback?.()
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    })()
  }, [applyReconciledMessages, deckId, onReloadFallback])

  useEffect(() => {
    writeChatSession(deckId, {
      messages,
      updatedAt: new Date().toISOString(),
      ...(deckId ? { failedPersistIds: [...failedPersistIds] } : {}),
    })
  }, [deckId, failedPersistIds, messages])

  const markDeliveryStatus = useCallback(
    (messageId: string, status: MessageDeliveryStatus) => {
      if (!deckIdRef.current) {
        return
      }

      setDeliveryStatus((current) => {
        const next = new Map(current)
        next.set(messageId, status)
        return next
      })

      if (status === 'failed') {
        setFailedPersistIds((current) => new Set(current).add(messageId))
        onPersistFailure?.(messageId)
        return
      }

      if (status === 'saved') {
        setFailedPersistIds((current) => {
          if (!current.has(messageId)) {
            return current
          }

          const next = new Set(current)
          next.delete(messageId)
          return next
        })
      }
    },
    [onPersistFailure],
  )

  const persistMessage = useCallback(
    async (message: ChatMessage, targetDeckId?: string | null) => {
      const activeDeckId = targetDeckId ?? deckIdRef.current

      if (!activeDeckId) {
        return true
      }

      markDeliveryStatus(message.id, 'saving')

      try {
        await appendDeckChatMessage(activeDeckId, {
          id: message.id,
          role: message.role,
          content: message.content,
          parts: message.parts,
          attachments: message.attachments,
          deckVersionId,
        })
        markDeliveryStatus(message.id, 'saved')
        return true
      } catch {
        markDeliveryStatus(message.id, 'failed')
        return false
      }
    },
    [deckVersionId, markDeliveryStatus],
  )

  const appendMessage = useCallback(
    async (message: ChatMessage, targetDeckId?: string | null) => {
      if (targetDeckId && targetDeckId !== deckIdRef.current) {
        loadRequestIdRef.current += 1
      }

      setMessages((current) => [...current, message])
      await persistMessage(message, targetDeckId)
    },
    [persistMessage],
  )

  const retryPersist = useCallback(
    async (messageId: string, targetDeckId?: string | null) => {
      const message = messagesRef.current.find((entry) => entry.id === messageId)

      if (!message) {
        return false
      }

      return persistMessage(message, targetDeckId)
    },
    [persistMessage],
  )

  const retryFailedPersists = useCallback(
    async (targetDeckId?: string | null) => {
      const failedInOrder = messagesRef.current
        .filter((message) => failedPersistIdsRef.current.has(message.id))
        .map((message) => message.id)

      let allSucceeded = true

      for (const messageId of failedInOrder) {
        const succeeded = await retryPersist(messageId, targetDeckId)
        if (!succeeded) {
          allSucceeded = false
        }
      }

      return allSucceeded
    },
    [retryPersist],
  )

  const reloadChat = useCallback(
    async (targetDeckId?: string | null) => {
      const activeDeckId = targetDeckId ?? deckIdRef.current

      if (!activeDeckId) {
        setIsReloadStale(false)
        return readChatSession(null)?.messages ?? []
      }

      const localMessages =
        activeDeckId === deckIdRef.current
          ? messagesRef.current
          : (readChatSession(activeDeckId)?.messages ?? [])

      try {
        const data = await fetchAllDeckChat(activeDeckId)
        const serverMessages = data.messages.map(persistedMessageToChatMessage)
        const { messages: merged, failedIds } = applyReconciledMessages(
          localMessages,
          serverMessages,
        )
        setIsReloadStale(false)
        writeChatSession(activeDeckId, {
          messages: merged,
          updatedAt: new Date().toISOString(),
          failedPersistIds: [...failedIds],
        })
        return merged
      } catch {
        setIsReloadStale(true)
        onReloadFallback?.()
        return readChatSession(activeDeckId)?.messages ?? localMessages
      }
    },
    [applyReconciledMessages, onReloadFallback],
  )

  const resetChat = useCallback(async () => {
    const activeDeckId = deckIdRef.current

    clearChatSession(activeDeckId)
    setMessages([])
    setFailedPersistIds(new Set())
    setDeliveryStatus(new Map())
    setIsReloadStale(false)

    if (!activeDeckId) {
      return true
    }

    try {
      await clearDeckChat(activeDeckId)
      return true
    } catch {
      onResetFailure?.()
      return false
    }
  }, [onResetFailure])

  const getMessageDeliveryStatus = useCallback(
    (messageId: string): MessageDeliveryStatus | undefined => {
      if (!deckIdRef.current) {
        return undefined
      }

      return deliveryStatus.get(messageId) ?? 'saved'
    },
    [deliveryStatus],
  )

  return {
    appendMessage,
    failedPersistIds,
    getMessageDeliveryStatus,
    isLoading,
    isReloadStale,
    messages,
    persistMessage,
    reloadChat,
    resetChat,
    retryFailedPersists,
    retryPersist,
    setMessages,
  }
}
