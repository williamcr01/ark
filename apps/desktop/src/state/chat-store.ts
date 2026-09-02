import { create } from 'zustand'

import type { AgentStep, ChatMessage } from '@ark/chat/chat.ts'
import type { GenerationJobApi, GenerationJobStatus } from '@ark/contracts'
import type { QueuedChatSend } from '@/lib/chat/chat-send-queue'
import { newId } from '@/lib/ui/id'

import { resolveUpdate, type StateUpdate } from './apply-update.ts'

export type MessageDeliveryStatus = 'saving' | 'saved' | 'failed'

export type ChatStoreState = {
  messages: ChatMessage[]
  input: string
  attachmentError: string
  queuedSends: QueuedChatSend[]
  isLoading: boolean
  failedPersistIds: Set<string>
  deliveryStatus: Map<string, MessageDeliveryStatus>
  isReloadStale: boolean
  trackedDeckId: string | null | undefined
  messagesDeckId: string | null
  activeJob: GenerationJobApi | null
  failedJob: GenerationJobApi | null
  isGenerating: boolean
  generationError: string
  workspaceError: string
  isPreviewUpdating: boolean
  isModelFailure: boolean
}

export type ChatThreadHydration = {
  trackedDeckId: string | null
  messagesDeckId: string | null
  messages?: ChatMessage[]
  failedPersistIds?: Set<string>
  deliveryStatus?: Map<string, MessageDeliveryStatus>
  isLoading: boolean
  isReloadStale?: boolean
}

export type ChatStoreActions = {
  appendMessage: (message: ChatMessage) => void
  applyReconciledMessages: (messages: ChatMessage[], failedIds: Set<string>) => void
  clearSends: () => void
  dequeueSend: (id: string) => QueuedChatSend | null
  dequeueNextSend: () => QueuedChatSend | null
  dismissError: () => void
  enqueueSend: (item: Omit<QueuedChatSend, 'id'> & { id?: string }) => QueuedChatSend
  hydrateThread: (patch: ChatThreadHydration) => void
  markDeliveryStatus: (messageId: string, status: MessageDeliveryStatus) => void
  moveSendToFront: (id: string) => void
  replaceMessages: (update: StateUpdate<ChatMessage[]>) => void
  reset: () => void
  setActiveJob: (activeJob: GenerationJobApi | null) => void
  setAttachmentError: (attachmentError: string) => void
  setChatLoading: (isLoading: boolean) => void
  setFailedJob: (failedJob: GenerationJobApi | null) => void
  setFailedPersistIds: (update: StateUpdate<Set<string>>) => void
  setGenerating: (isGenerating: boolean) => void
  setGenerationError: (generationError: string) => void
  setWorkspaceError: (workspaceError: string) => void
  setInput: (update: StateUpdate<string>) => void
  setMessagesDeckId: (messagesDeckId: string | null) => void
  setModelFailure: (isModelFailure: boolean) => void
  setPreviewUpdating: (update: StateUpdate<boolean>) => void
  setReloadStale: (isReloadStale: boolean) => void
  updateSendText: (id: string, text: string) => void
}

export type ChatStore = ChatStoreState & ChatStoreActions

export function buildDeliveryStatusMap(
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

const initialState = (): ChatStoreState => ({
  messages: [],
  input: '',
  attachmentError: '',
  queuedSends: [],
  isLoading: false,
  failedPersistIds: new Set(),
  deliveryStatus: new Map(),
  isReloadStale: false,
  trackedDeckId: undefined,
  messagesDeckId: null,
  activeJob: null,
  failedJob: null,
  isGenerating: false,
  generationError: '',
  workspaceError: '',
  isPreviewUpdating: false,
  isModelFailure: false,
})

export const useChatStore = create<ChatStore>()((set, get) => ({
  ...initialState(),
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
  dismissError: () => {
    set({ attachmentError: '', generationError: '', workspaceError: '' })
  },
  enqueueSend: (item) => {
    const queued: QueuedChatSend = {
      ...item,
      id: item.id ?? newId(),
    }
    set((state) => ({ queuedSends: [...state.queuedSends, queued] }))
    return queued
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
  markDeliveryStatus: (messageId, status) => {
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
  moveSendToFront: (id) => {
    const items = get().queuedSends
    const index = items.findIndex((item) => item.id === id)
    if (index <= 0) {
      return
    }

    const next = [...items]
    const [item] = next.splice(index, 1)
    set({ queuedSends: [item, ...next] })
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
  updateSendText: (id, text) => {
    set((state) => ({
      queuedSends: state.queuedSends.map((item) => (item.id === id ? { ...item, text } : item)),
    }))
  },
}))

export const selectActiveJobId = (state: ChatStoreState) => state.activeJob?.id ?? null

export const selectFailedJobId = (state: ChatStoreState) => state.failedJob?.id ?? null

export const selectActiveSteps = (state: ChatStoreState): AgentStep[] =>
  state.activeJob?.progress.steps ?? []

export const selectGenerationStatus = (state: ChatStoreState): GenerationJobStatus | null =>
  state.activeJob?.status ?? null

export const useChatMessages = () => useChatStore((state) => state.messages)
export const useChatInput = () => useChatStore((state) => state.input)
