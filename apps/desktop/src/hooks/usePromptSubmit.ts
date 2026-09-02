import { useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router'

import { toQueuedChatSendPreview } from '@/lib/chat/chat-send-queue'
import { submitPromptMessage, type SubmitPromptMessageDeps } from '@/lib/chat/submit-prompt-message'
import { type PromptSubmitMessage } from '@/lib/chat/upload-prompt-attachments'
import { routeDeckIdFromParam } from '@/lib/ui/workspace-mode'
import { useChatStore } from '@/state/chat-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'

import {
  useChatSendQueue,
  useFlushQueuedChatSends,
  type ChatSendQueueItem,
} from './useChatSendQueue'
import { useWorkspaceRuntimeContext } from './workspace-runtime-context'

export type UsePromptSubmitResult = {
  handlePromptSubmit: (message: PromptSubmitMessage) => Promise<void>
  sendQueuedNow: (id: string) => Promise<void>
  sendQueuedAll: () => Promise<void>
  queuedSends: ReturnType<typeof toQueuedChatSendPreview>[]
  dismissQueuedSend: (id: string) => void
  updateQueuedText: (id: string, text: string) => void
}

export function usePromptSubmit(): UsePromptSubmitResult {
  const { persistence, generation, models } = useWorkspaceRuntimeContext()
  const { deckId, ensureBlankDeck } = persistence
  const { generateDeck, isGenerating } = generation
  const { canGenerate, selectedModel } = models
  const catalog = models.models
  const setInput = useChatStore((state) => state.setInput)
  const setAttachmentError = useChatStore((state) => state.setAttachmentError)
  const editorSelection = useEditorStore((state) => state.editorSelection)
  const editorSelections = useEditorStore((state) => state.editorSelections)
  const contextSlideEntries = useEditorStore((state) => state.contextSlides)
  const sendQueue = useChatSendQueue()
  const clearSendQueue = sendQueue.clear
  const { deckId: routeParam } = useParams<{ deckId: string }>()
  const routeDeckId = routeDeckIdFromParam(routeParam)

  const dispatchQueuedSend = useCallback(
    async (item: ChatSendQueueItem) => {
      await generateDeck(item.text, item.attachments, {
        assetIds: item.assetIds,
        deckId: item.deckId,
        editorSelection: item.editorSelection,
        editorSelections: item.editorSelections,
        slideContexts: item.slideContexts,
      })
    },
    [generateDeck],
  )
  const { sendNow: sendQueuedNow, sendAll: sendQueuedAll } = useFlushQueuedChatSends(
    sendQueue,
    isGenerating,
    dispatchQueuedSend,
  )

  const prevRouteDeckIdRef = useRef(routeDeckId)
  useEffect(() => {
    const previous = prevRouteDeckIdRef.current
    prevRouteDeckIdRef.current = routeDeckId
    if (previous === routeDeckId) {
      return
    }
    if (previous == null && routeDeckId) {
      return
    }
    clearSendQueue()
  }, [clearSendQueue, routeDeckId])

  const handlePromptSubmit = (message: PromptSubmitMessage) => {
    const deps: SubmitPromptMessageDeps = {
      canGenerate,
      catalog,
      selectedModel,
      deckId,
      html: persistence.html,
      ensureBlankDeck,
      isGenerating,
      editorSelection,
      editorSelections,
      contextSlideEntries,
      setAttachmentError,
      setInput,
      enqueue: sendQueue.enqueue,
      generateDeck,
    }
    return submitPromptMessage(message, deps)
  }

  return {
    handlePromptSubmit,
    sendQueuedNow,
    sendQueuedAll,
    queuedSends: sendQueue.items.map(toQueuedChatSendPreview),
    dismissQueuedSend: sendQueue.dismiss,
    updateQueuedText: sendQueue.updateText,
  }
}
