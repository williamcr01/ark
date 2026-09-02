import { useCallback, useEffect, useRef } from 'react'

import type { ChatMessage } from '@ark/chat/chat.ts'
import { writeChatSession } from '@/lib/chat/chat-session'
import { useChatStore, type MessageDeliveryStatus } from '@/state/chat-store.ts'

import {
  appendChatMessage,
  hydrateVisibleThread,
  loadDeckChatThread,
  persistChatMessage,
  reloadChatThread,
  resetChatThread,
  retryChatPersist,
  retryFailedChatPersists,
} from './chat-session-runtime.ts'

export type { MessageDeliveryStatus }

export type UseChatSessionOptions = {
  deckId: string | null
  onPersistFailure?: (messageId: string) => void
  onResetFailure?: () => void
  onReloadFallback?: () => void
}

export function useChatSession({
  deckId,
  onPersistFailure,
  onResetFailure,
  onReloadFallback,
}: UseChatSessionOptions) {
  const loadRequestIdRef = useRef(0)
  const deckIdRef = useRef(deckId)

  hydrateVisibleThread(deckId)

  const messages = useChatStore((state) => state.messages)
  const failedPersistIds = useChatStore((state) => state.failedPersistIds)
  const messagesDeckId = useChatStore((state) => state.messagesDeckId)

  useEffect(() => {
    deckIdRef.current = deckId
  }, [deckId])

  useEffect(() => {
    const requestId = ++loadRequestIdRef.current

    if (!deckId) {
      return
    }

    void loadDeckChatThread(deckId, requestId, loadRequestIdRef, onReloadFallback)
  }, [deckId, onReloadFallback])

  useEffect(() => {
    writeChatSession(messagesDeckId, {
      messages,
      updatedAt: new Date().toISOString(),
      ...(messagesDeckId ? { failedPersistIds: [...failedPersistIds] } : {}),
    })
  }, [failedPersistIds, messages, messagesDeckId])

  const markDeliveryStatus = useCallback(
    (messageId: string, status: MessageDeliveryStatus) => {
      if (!deckIdRef.current) {
        return
      }

      useChatStore.getState().markDeliveryStatus(messageId, status)
      if (status === 'failed') {
        onPersistFailure?.(messageId)
      }
    },
    [onPersistFailure],
  )

  const persistMessage = useCallback(
    async (message: ChatMessage, targetDeckId?: string | null) =>
      persistChatMessage(message, targetDeckId ?? deckIdRef.current, markDeliveryStatus),
    [markDeliveryStatus],
  )

  const appendMessage = useCallback(
    async (message: ChatMessage, targetDeckId?: string | null) =>
      appendChatMessage(message, targetDeckId, deckIdRef.current, loadRequestIdRef, persistMessage),
    [persistMessage],
  )

  const retryPersist = useCallback(
    async (messageId: string, targetDeckId?: string | null) =>
      retryChatPersist(messageId, targetDeckId, persistMessage),
    [persistMessage],
  )

  const retryFailedPersists = useCallback(
    async (targetDeckId?: string | null) => retryFailedChatPersists(targetDeckId, retryPersist),
    [retryPersist],
  )

  const reloadChat = useCallback(
    async (targetDeckId?: string | null) =>
      reloadChatThread(targetDeckId ?? deckIdRef.current, onReloadFallback),
    [onReloadFallback],
  )

  const resetChat = useCallback(
    async (targetDeckId?: string | null) =>
      resetChatThread(
        targetDeckId === undefined ? deckIdRef.current : targetDeckId,
        loadRequestIdRef,
        onResetFailure,
      ),
    [onResetFailure],
  )

  const getMessageDeliveryStatus = useCallback(
    (messageId: string): MessageDeliveryStatus | undefined => {
      if (!deckIdRef.current) {
        return undefined
      }

      return useChatStore.getState().deliveryStatus.get(messageId) ?? 'saved'
    },
    [],
  )

  const setMessages = useChatStore((state) => state.replaceMessages)

  return {
    appendMessage,
    getMessageDeliveryStatus,
    persistMessage,
    reloadChat,
    resetChat,
    retryFailedPersists,
    retryPersist,
    setMessages,
  }
}
