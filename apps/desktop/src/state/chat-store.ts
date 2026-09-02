import { create } from 'zustand'

import type { AgentStep, ChatMessage } from '@ark/chat/chat.ts'
import type { GenerationJobApi, GenerationJobStatus } from '@ark/contracts'
import type { QueuedChatSend } from '@/lib/chat/chat-send-queue'

import { type StateUpdate } from './apply-update.ts'
import { createChatQueueActions, createChatThreadActions } from './chat-store-actions.ts'

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
  ...createChatQueueActions(set, get),
  ...createChatThreadActions(set, initialState),
}))

const EMPTY_AGENT_STEPS: AgentStep[] = []

export const selectActiveJobId = (state: ChatStoreState) => state.activeJob?.id ?? null

export const selectFailedJobId = (state: ChatStoreState) => state.failedJob?.id ?? null

export const selectActiveSteps = (state: ChatStoreState): AgentStep[] =>
  state.activeJob?.progress.steps ?? EMPTY_AGENT_STEPS

export const selectGenerationStatus = (state: ChatStoreState): GenerationJobStatus | null =>
  state.activeJob?.status ?? null

export const useChatMessages = () => useChatStore((state) => state.messages)
export const useChatInput = () => useChatStore((state) => state.input)
