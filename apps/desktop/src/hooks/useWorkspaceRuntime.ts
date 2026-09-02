import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import { parseInitialSlideIndex } from '@/lib/ui/app-shell-preferences'
import { resolveWorkspaceMode, routeDeckIdFromParam } from '@/lib/ui/workspace-mode'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore, type DeckEditHistoryEntry } from '@/state/editor-store.ts'

import { selectDeckPersistenceSnapshot } from './deck-persistence.ts'
import { useAvailableModels } from './useAvailableModels'
import { useChatSession } from './useChatSession'
import { useDeckDocumentActions } from './useDeckDocumentActions'
import { useDeckEditHistory } from './useDeckEditHistory'
import { useDeckGenerationFlow } from './useDeckGenerationFlow'
import { useDeckPersistence } from './useDeckPersistence'
import { useReasoningEffort } from './useReasoningEffort'
import type { WorkspaceRuntimeValue } from './workspace-runtime-context'

function notifyChatPersistFailure() {
  toast.error("Message couldn't be saved to the server — kept locally")
}

function notifyChatResetFailure() {
  toast.error('Chat was cleared locally but may still exist on the server')
}

function notifyChatReloadFallback() {
  toast.warning('Could not refresh chat from server — showing cached messages')
}

function clearAttachmentError() {
  useChatStore.getState().setAttachmentError('')
}

function recordAgentGenerationChange(
  recordEditHistory: (entry: DeckEditHistoryEntry) => void,
  readHistorySlideIndex: () => number,
  change: { deckChanged: boolean; beforeHtml: string; afterHtml: string },
) {
  useEditorStore.getState().setContextSlides([])
  if (!change.deckChanged) {
    return
  }
  recordEditHistory({
    beforeHtml: change.beforeHtml,
    afterHtml: change.afterHtml,
    slideIndex: readHistorySlideIndex(),
    provenance: {
      source: 'agent',
      summary: 'Applied agent write',
      createdAt: new Date().toISOString(),
    },
  })
}

function useWorkspaceDeckSessionEffects(
  deckId: string | null,
  deckTitle: string,
  documentRevision: number | null,
  resetEditHistory: () => void,
) {
  useEffect(() => {
    void window.arkDesktop.mcp.setActiveDeck(
      deckId,
      deckId ? deckTitle : null,
      deckId ? documentRevision : null,
    )
  }, [deckId, deckTitle, documentRevision])

  useEffect(() => {
    resetEditHistory()
  }, [deckId, resetEditHistory])

  const [prevDeckIdForContext, setPrevDeckIdForContext] = useState(deckId)
  if (deckId !== prevDeckIdForContext) {
    setPrevDeckIdForContext(deckId)
    useEditorStore.getState().setContextSlides([])
    useEditorStore.getState().clearSelection()
  }
}

export function useWorkspaceRuntime(): WorkspaceRuntimeValue {
  const navigate = useNavigate()
  const { deckId: routeParam } = useParams<{ deckId: string }>()
  const [searchParams] = useSearchParams()
  const routeDeckId = routeDeckIdFromParam(routeParam)
  const initialSlideIndex = parseInitialSlideIndex(searchParams.get('slide'))

  const persistenceActions = useDeckPersistence(routeDeckId)
  const documentActions = useDeckDocumentActions()
  const snapshot = useDeckStore(useShallow(selectDeckPersistenceSnapshot))
  const persistence = { ...snapshot, ...documentActions, ...persistenceActions }
  const {
    deckId,
    deckTitle,
    documentRevision,
    html: generatedHtml,
    isLoading: isDeckLoading,
    origin,
    refreshActiveDeck,
  } = persistence

  const workspaceMode = resolveWorkspaceMode(origin, routeDeckId, isDeckLoading)

  useEffect(() => {
    if (deckId && !routeDeckId) {
      navigate(`/decks/${deckId}`, { replace: true })
    }
  }, [deckId, navigate, routeDeckId])

  const chat = useChatSession({
    deckId,
    onPersistFailure: notifyChatPersistFailure,
    onResetFailure: notifyChatResetFailure,
    onReloadFallback: notifyChatReloadFallback,
  })

  const models = useAvailableModels()
  const { reasoningEffort } = useReasoningEffort(models.selectedModel, models.models)
  const { record: recordEditHistory, reset: resetEditHistory } = useDeckEditHistory()

  const deckPreviewRef = useRef<DeckPreviewHandle>(null)
  const htmlRef = useRef(generatedHtml)
  const editorSelectionRef = useRef(useEditorStore.getState().editorSelection)
  const initialSlideIndexRef = useRef(initialSlideIndex)

  const readHistorySlideIndex = useCallback(
    () =>
      editorSelectionRef.current?.slideIndex ??
      deckPreviewRef.current?.getActiveSlideIndex() ??
      initialSlideIndexRef.current,
    [],
  )

  useEffect(() => {
    htmlRef.current = generatedHtml
  }, [generatedHtml])

  useEffect(() => {
    initialSlideIndexRef.current = initialSlideIndex
  }, [initialSlideIndex])

  const editorSelection = useEditorStore((state) => state.editorSelection)
  useEffect(() => {
    editorSelectionRef.current = editorSelection
  }, [editorSelection])

  const generation = useDeckGenerationFlow({
    deck: {
      deckId,
      documentRevision,
      generatedHtml,
      isDeckLoading,
      refreshActiveDeck,
    },
    chat: {
      messages: chat.messages,
      appendMessage: chat.appendMessage,
      reloadChat: chat.reloadChat,
      setMessages: chat.setMessages,
    },
    selectedModel: models.selectedModel,
    reasoningEffort,
    canGenerate: models.canGenerate,
    loadModels: models.loadModels,
    onError: useChatStore.getState().setWorkspaceError,
    onGenerationStart: clearAttachmentError,
    onGenerationSucceeded: useCallback(
      (change) => recordAgentGenerationChange(recordEditHistory, readHistorySlideIndex, change),
      [readHistorySlideIndex, recordEditHistory],
    ),
  })

  useWorkspaceDeckSessionEffects(deckId, deckTitle, documentRevision, resetEditHistory)

  return {
    persistence,
    chat,
    generation,
    models,
    workspaceMode,
    initialSlideIndex,
    deckPreviewRef,
    htmlRef,
    readHistorySlideIndex,
  }
}
