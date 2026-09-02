import type { StoreApi } from 'zustand'

import type { QueuedChatSend } from '@/lib/chat/chat-send-queue'
import { newId } from '@/lib/ui/id'

import { resolveUpdate } from './apply-update.ts'
import {
  buildDeliveryStatusMap,
  type ChatStore,
  type ChatStoreActions,
  type ChatStoreState,
  type MessageDeliveryStatus,
} from './chat-store.ts'

type ChatSet = StoreApi<ChatStore>['setState']
type ChatGet = StoreApi<ChatStore>['getState']

export function createChatQueueActions(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatStoreActions,
  | 'clearSends'
  | 'dequeueSend'
  | 'dequeueNextSend'
  | 'enqueueSend'
  | 'moveSendToFront'
  | 'updateSendText'
> {
  return {
    clearSends: () => {
      set({ queuedSends: [] })
    },
    dequeueSend: (id) => {
      const item = get().queuedSends.find((entry) => entry.id === id) ?? null
      if (!item) {
        return null
      }

      set((state) => ({
        queuedSends: state.queuedSends.filter((entry) => entry.id !== id),
      }))
      return item
    },
    dequeueNextSend: () => {
      const [item] = get().queuedSends
      if (!item) {
        return null
      }

      set((state) => ({ queuedSends: state.queuedSends.slice(1) }))
      return item
    },
    enqueueSend: (item) => {
      const queued: QueuedChatSend = {
        ...item,
        id: item.id ?? newId(),
      }
      set((state) => ({ queuedSends: [...state.queuedSends, queued] }))
      return queued
    },
    moveSendToFront: (id) => {
      const items = get().queuedSends
      const index = items.findIndex((queued) => queued.id === id)
      if (index <= 0) {
        return
      }

      const next = [...items]
      const [item] = next.splice(index, 1)
      set({ queuedSends: [item, ...next] })
    },
    updateSendText: (id, text) => {
      set((state) => ({
        queuedSends: state.queuedSends.map((item) => (item.id === id ? { ...item, text } : item)),
      }))
    },
  }
}

export function createChatThreadActions(
  set: ChatSet,
  initialState: () => ChatStoreState,
): Omit<
  ChatStoreActions,
  | 'clearSends'
  | 'dequeueSend'
  | 'dequeueNextSend'
  | 'enqueueSend'
  | 'moveSendToFront'
  | 'updateSendText'
> {
  return {
    appendMessage: (message) => {
      set((state) => ({ messages: [...state.messages, message] }))
    },
    applyReconciledMessages: (messages, failedIds) => {
      set({
        messages,
        failedPersistIds: failedIds,
        deliveryStatus: buildDeliveryStatusMap(messages, failedIds),
      })
    },
    dismissError: () => {
      set({ attachmentError: '', generationError: '', workspaceError: '' })
    },
    hydrateThread: (patch) => {
      set((state) => ({
        trackedDeckId: patch.trackedDeckId,
        messagesDeckId: patch.messagesDeckId,
        messages: patch.messages ?? state.messages,
        failedPersistIds: patch.failedPersistIds ?? state.failedPersistIds,
        deliveryStatus: patch.deliveryStatus ?? state.deliveryStatus,
        isLoading: patch.isLoading,
        isReloadStale: patch.isReloadStale ?? false,
      }))
    },
    markDeliveryStatus: (messageId, status: MessageDeliveryStatus) => {
      set((state) => {
        const deliveryStatus = new Map(state.deliveryStatus)
        deliveryStatus.set(messageId, status)

        let failedPersistIds = state.failedPersistIds
        if (status === 'failed') {
          failedPersistIds = new Set(state.failedPersistIds).add(messageId)
        } else if (status === 'saved' && state.failedPersistIds.has(messageId)) {
          failedPersistIds = new Set(state.failedPersistIds)
          failedPersistIds.delete(messageId)
        }

        return { deliveryStatus, failedPersistIds }
      })
    },
    replaceMessages: (update) => {
      set((state) => ({ messages: resolveUpdate(state.messages, update) }))
    },
    reset: () => {
      set(initialState())
    },
    setActiveJob: (activeJob) => {
      set({ activeJob })
    },
    setAttachmentError: (attachmentError) => {
      set({ attachmentError })
    },
    setChatLoading: (isLoading) => {
      set({ isLoading })
    },
    setFailedJob: (failedJob) => {
      set({ failedJob })
    },
    setFailedPersistIds: (update) => {
      set((state) => ({ failedPersistIds: resolveUpdate(state.failedPersistIds, update) }))
    },
    setGenerating: (isGenerating) => {
      set({ isGenerating })
    },
    setGenerationError: (generationError) => {
      set({ generationError })
    },
    setWorkspaceError: (workspaceError) => {
      set({ workspaceError })
    },
    setInput: (update) => {
      set((state) => ({ input: resolveUpdate(state.input, update) }))
    },
    setMessagesDeckId: (messagesDeckId) => {
      set({ messagesDeckId })
    },
    setModelFailure: (isModelFailure) => {
      set({ isModelFailure })
    },
    setPreviewUpdating: (update) => {
      set((state) => ({ isPreviewUpdating: resolveUpdate(state.isPreviewUpdating, update) }))
    },
    setReloadStale: (isReloadStale) => {
      set({ isReloadStale })
    },
  }
}
