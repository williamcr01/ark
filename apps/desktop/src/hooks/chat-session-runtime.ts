import type { ChatMessage } from '@ark/chat/messages.ts'
import { persistedMessageToChatMessage } from '@ark/chat/chat-thread.ts'
import { appendDeckChatMessage, clearDeckChat, fetchAllDeckChat } from '@/lib/api/chat-api'
import { reconcileChatMessages } from '@/lib/chat/chat-reconcile'
import { clearChatSession, readChatSession, writeChatSession } from '@/lib/chat/chat-session'
import {
  buildDeliveryStatusMap,
  useChatStore,
  type MessageDeliveryStatus,
} from '@/state/chat-store.ts'

export function hydrateVisibleThread(deckId: string | null) {
  const state = useChatStore.getState()
  if (state.trackedDeckId === deckId) {
    return
  }

  if (!deckId) {
    useChatStore.getState().hydrateThread({
      trackedDeckId: null,
      messagesDeckId: null,
      messages: readChatSession(null)?.messages ?? [],
      failedPersistIds: new Set(),
      deliveryStatus: new Map(),
      isLoading: false,
      isReloadStale: false,
    })
    return
  }

  const localSession = readChatSession(deckId)
  const keepInFlight =
    state.messagesDeckId === null &&
    state.messages.length > 0 &&
    (!localSession || localSession.messages.length === 0)

  if (keepInFlight) {
    useChatStore.getState().hydrateThread({
      trackedDeckId: deckId,
      messagesDeckId: deckId,
      deliveryStatus: buildDeliveryStatusMap(state.messages, state.failedPersistIds),
      isLoading: true,
      isReloadStale: false,
    })
    return
  }

  const localMessages = localSession?.messages ?? []
  const storedFailedIds = new Set(localSession?.failedPersistIds ?? [])
  useChatStore.getState().hydrateThread({
    trackedDeckId: deckId,
    messagesDeckId: deckId,
    messages: localMessages,
    failedPersistIds: storedFailedIds,
    deliveryStatus: buildDeliveryStatusMap(localMessages, storedFailedIds),
    isLoading: true,
    isReloadStale: false,
  })
}

export function applyReconciledMessages(
  localMessages: ChatMessage[],
  serverMessages: ChatMessage[],
  knownFailedIds: Set<string> = useChatStore.getState().failedPersistIds,
) {
  const { messages: merged, failedIds } = reconcileChatMessages(
    localMessages,
    serverMessages,
    knownFailedIds,
  )
  useChatStore.getState().applyReconciledMessages(merged, failedIds)
  return { messages: merged, failedIds }
}

export async function persistChatMessage(
  message: ChatMessage,
  activeDeckId: string | null | undefined,
  markDeliveryStatus: (messageId: string, status: MessageDeliveryStatus) => void,
) {
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
      context: message.context,
    })
    markDeliveryStatus(message.id, 'saved')
    return true
  } catch {
    markDeliveryStatus(message.id, 'failed')
    return false
  }
}

export async function appendChatMessage(
  message: ChatMessage,
  targetDeckId: string | null | undefined,
  currentDeckId: string | null,
  loadRequestIdRef: { current: number },
  persistMessage: (message: ChatMessage, targetDeckId?: string | null) => Promise<boolean>,
) {
  if (targetDeckId && targetDeckId !== currentDeckId) {
    loadRequestIdRef.current += 1
    useChatStore.getState().setMessagesDeckId(targetDeckId)
  }

  useChatStore.getState().appendMessage(message)
  await persistMessage(message, targetDeckId)
}

export async function retryChatPersist(
  messageId: string,
  targetDeckId: string | null | undefined,
  persistMessage: (message: ChatMessage, targetDeckId?: string | null) => Promise<boolean>,
) {
  const message = useChatStore.getState().messages.find((entry) => entry.id === messageId)

  if (!message) {
    return false
  }

  return persistMessage(message, targetDeckId)
}

export async function retryFailedChatPersists(
  targetDeckId: string | null | undefined,
  retryPersist: (messageId: string, targetDeckId?: string | null) => Promise<boolean>,
) {
  const chat = useChatStore.getState()
  const failedInOrder: string[] = []

  for (const message of chat.messages) {
    if (chat.failedPersistIds.has(message.id)) {
      failedInOrder.push(message.id)
    }
  }

  let allSucceeded = true

  for (const messageId of failedInOrder) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential retry of failed message persists: persistence is order-sensitive and each retry must complete before the next starts
    const succeeded = await retryPersist(messageId, targetDeckId)
    if (!succeeded) {
      allSucceeded = false
    }
  }

  return allSucceeded
}

export async function reloadChatThread(
  activeDeckId: string | null | undefined,
  onReloadFallback?: () => void,
) {
  const chat = useChatStore.getState()

  if (!activeDeckId) {
    useChatStore.getState().hydrateThread({
      trackedDeckId: null,
      messagesDeckId: null,
      isLoading: chat.isLoading,
      isReloadStale: false,
    })
    return readChatSession(null)?.messages ?? []
  }

  const localMessages =
    activeDeckId === chat.messagesDeckId
      ? chat.messages
      : (readChatSession(activeDeckId)?.messages ?? [])

  try {
    const data = await fetchAllDeckChat(activeDeckId)
    const serverMessages = data.messages.map(persistedMessageToChatMessage)
    useChatStore.getState().setMessagesDeckId(activeDeckId)
    const { messages: merged, failedIds } = applyReconciledMessages(localMessages, serverMessages)
    useChatStore.getState().setReloadStale(false)
    writeChatSession(activeDeckId, {
      messages: merged,
      updatedAt: new Date().toISOString(),
      failedPersistIds: [...failedIds],
    })
    return merged
  } catch {
    useChatStore.getState().setMessagesDeckId(activeDeckId)
    useChatStore.getState().setReloadStale(true)
    onReloadFallback?.()
    return readChatSession(activeDeckId)?.messages ?? localMessages
  }
}

export async function resetChatThread(
  activeDeckId: string | null | undefined,
  loadRequestIdRef: { current: number },
  onResetFailure?: () => void,
) {
  clearChatSession(activeDeckId)
  loadRequestIdRef.current += 1
  useChatStore.getState().hydrateThread({
    trackedDeckId: activeDeckId ?? null,
    messagesDeckId: activeDeckId ?? null,
    messages: [],
    failedPersistIds: new Set(),
    deliveryStatus: new Map(),
    isLoading: false,
    isReloadStale: false,
  })

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
}

export async function loadDeckChatThread(
  deckId: string,
  requestId: number,
  loadRequestIdRef: { current: number },
  onReloadFallback?: () => void,
) {
  const chat = useChatStore.getState()
  let localSession = readChatSession(deckId)

  if (
    (!localSession || localSession.messages.length === 0) &&
    chat.messagesDeckId === deckId &&
    chat.messages.length > 0
  ) {
    localSession = {
      messages: chat.messages,
      updatedAt: new Date().toISOString(),
      failedPersistIds: [...chat.failedPersistIds],
    }
    writeChatSession(deckId, localSession)
    clearChatSession(null)
  }

  const localMessages = localSession?.messages ?? useChatStore.getState().messages
  const storedFailedIds = new Set(
    localSession?.failedPersistIds ?? [...useChatStore.getState().failedPersistIds],
  )

  try {
    const data = await fetchAllDeckChat(deckId)
    const serverMessages = data.messages.map(persistedMessageToChatMessage)

    if (loadRequestIdRef.current !== requestId) {
      return
    }

    useChatStore.getState().setMessagesDeckId(deckId)
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
    useChatStore.getState().hydrateThread({
      trackedDeckId: deckId,
      messagesDeckId: deckId,
      messages: cachedMessages,
      failedPersistIds: storedFailedIds,
      deliveryStatus: buildDeliveryStatusMap(cachedMessages, storedFailedIds),
      isLoading: false,
      isReloadStale: true,
    })
    onReloadFallback?.()
  } finally {
    if (loadRequestIdRef.current === requestId) {
      useChatStore.getState().setChatLoading(false)
    }
  }
}
