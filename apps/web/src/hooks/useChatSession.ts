import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatMessage } from '@ark/deck-core/chat.ts'
import { persistedMessageToChatMessage } from '@ark/deck-core/chat-thread.ts'
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
  // Which deck the current `messages` state belongs to. Prevents writing the
  // previous thread into the next deck's local cache during a switch.
  const messagesDeckIdRef = useRef<string | null>(deckId)

  deckIdRef.current = deckId

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
    const previousMessagesDeckId = messagesDeckIdRef.current

    setIsReloadStale(false)

    if (!deckId) {
      const localMessages = readChatSession(null)?.messages ?? []
      messagesDeckIdRef.current = null
      setMessages(localMessages)
      setFailedPersistIds(new Set())
      setDeliveryStatus(new Map())
      setIsLoading(false)
      return
    }

    let localSession = readChatSession(deckId)
    const inFlightMessages = messagesRef.current
    const inFlightFailedIds = failedPersistIdsRef.current

    // New deck created from an unsaved session: keep the in-progress thread
    // instead of flashing empty while the server catch-up loads.
    if (
      previousMessagesDeckId === null &&
      inFlightMessages.length > 0 &&
      (!localSession || localSession.messages.length === 0)
    ) {
      localSession = {
        messages: inFlightMessages,
        updatedAt: new Date().toISOString(),
        failedPersistIds: [...inFlightFailedIds],
      }
      writeChatSession(deckId, localSession)
      clearChatSession(null)
    }

    const localMessages = localSession?.messages ?? []
    const storedFailedIds = new Set(localSession?.failedPersistIds ?? [])

    // Swap the visible thread immediately so the previous deck's chat does not linger.
    messagesDeckIdRef.current = deckId
    setMessages(localMessages)
    setFailedPersistIds(storedFailedIds)
    setDeliveryStatus(buildDeliveryStatusMap(localMessages, storedFailedIds))
    setIsLoading(true)

    void (async () => {
      try {
        const data = await fetchAllDeckChat(deckId)
        const serverMessages = data.messages.map(persistedMessageToChatMessage)

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        messagesDeckIdRef.current = deckId
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

        const cachedMessages = readChatSession(deckId)?.messages ?? localMessages
        messagesDeckIdRef.current = deckId
        setMessages(cachedMessages)
        setFailedPersistIds(storedFailedIds)
        setDeliveryStatus(buildDeliveryStatusMap(cachedMessages, storedFailedIds))
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
    // Persist against the deck the messages belong to — not a newly selected deckId
    // that has not received its thread yet.
    writeChatSession(messagesDeckIdRef.current, {
      messages,
      updatedAt: new Date().toISOString(),
      ...(messagesDeckIdRef.current
        ? { failedPersistIds: [...failedPersistIds] }
        : {}),
    })
  }, [failedPersistIds, messages])

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
        messagesDeckIdRef.current = targetDeckId
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
        messagesDeckIdRef.current = null
        setIsReloadStale(false)
        return readChatSession(null)?.messages ?? []
      }

      const localMessages =
        activeDeckId === messagesDeckIdRef.current
          ? messagesRef.current
          : (readChatSession(activeDeckId)?.messages ?? [])

      try {
        const data = await fetchAllDeckChat(activeDeckId)
        const serverMessages = data.messages.map(persistedMessageToChatMessage)
        messagesDeckIdRef.current = activeDeckId
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
        messagesDeckIdRef.current = activeDeckId
        setIsReloadStale(true)
        onReloadFallback?.()
        return readChatSession(activeDeckId)?.messages ?? localMessages
      }
    },
    [applyReconciledMessages, onReloadFallback],
  )

  const resetChat = useCallback(
    async (targetDeckId?: string | null) => {
      // Use === undefined (not ??) so explicit null targets the unsaved session.
      const activeDeckId = targetDeckId === undefined ? deckIdRef.current : targetDeckId

      clearChatSession(activeDeckId)
      loadRequestIdRef.current += 1
      messagesDeckIdRef.current = activeDeckId
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
    },
    [onResetFailure],
  )

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
