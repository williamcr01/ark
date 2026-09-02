import { useCallback, useEffect, useRef } from 'react'

import { toast } from 'sonner'

import type {
  ChatAttachment,
  EditorSelectionContext,
  SlideContext,
  ThemeSelectionContext,
} from '@ark/chat/chat.ts'
import type { ReasoningEffort } from '@ark/contracts'
import { useChatStore, selectFailedJobId } from '@/state/chat-store.ts'

import { useGenerationJob } from './useGenerationJob'
import {
  generateDeckTurn,
  recoverStoredGenerationOutcome,
  retryGenerationTurn,
  type GenerationFlowChat,
  type GenerationHistoryChange,
} from './generation-flow-runtime.ts'

type DeckPersistenceSlice = {
  deckId: string | null
  documentRevision: number | null
  generatedHtml: string
  isDeckLoading: boolean
  refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
}

export type { GenerationHistoryChange }

export type UseDeckGenerationFlowOptions = {
  deck: DeckPersistenceSlice
  chat: GenerationFlowChat
  selectedModel: string
  reasoningEffort?: ReasoningEffort
  canGenerate: boolean
  loadModels: () => Promise<void>
  onError: (message: string) => void
  onGenerationStart?: () => void
  onGenerationSucceeded?: (change: GenerationHistoryChange) => void
}

export function useDeckGenerationFlow({
  deck,
  chat,
  selectedModel,
  reasoningEffort,
  canGenerate,
  loadModels,
  onError,
  onGenerationStart,
  onGenerationSucceeded,
}: UseDeckGenerationFlowOptions) {
  const { deckId, documentRevision, generatedHtml, isDeckLoading, refreshActiveDeck } = deck
  const { messages, appendMessage, reloadChat, setMessages } = chat

  const {
    cancelGeneration,
    retryGeneration,
    resumeStoredJob,
    setError: setGenerationError,
    startGeneration,
  } = useGenerationJob({
    deckId,
    baseDocumentRevision: documentRevision,
    selectedModel,
    reasoningEffort,
    canGenerate,
    onReloadModels: loadModels,
  })

  const activeJob = useChatStore((state) => state.activeJob)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const generationError = useChatStore((state) => state.generationError)
  const isPreviewUpdating = useChatStore((state) => state.isPreviewUpdating)
  const recoveredJobIdsRef = useRef(new Set<string>())
  const generatedHtmlRef = useRef(generatedHtml)
  const modelFailure = useChatStore((state) => state.isModelFailure)
  const failedJobId = useChatStore(selectFailedJobId)

  useEffect(() => {
    generatedHtmlRef.current = generatedHtml
  }, [generatedHtml])

  useEffect(() => {
    if (isDeckLoading) {
      return
    }

    let cancelled = false
    const recovery = {
      chat: { appendMessage, reloadChat, setMessages },
      deckId,
      generatedHtmlRef,
      refreshActiveDeck,
      onError,
      onGenerationSucceeded,
    }

    void (async () => {
      const outcome = await resumeStoredJob()
      await recoverStoredGenerationOutcome(outcome, cancelled, recoveredJobIdsRef.current, recovery)
    })()

    return () => {
      cancelled = true
    }
  }, [
    appendMessage,
    deckId,
    isDeckLoading,
    onError,
    onGenerationSucceeded,
    refreshActiveDeck,
    reloadChat,
    resumeStoredJob,
    setMessages,
  ])

  const generateDeck = useCallback(
    async (
      rawPrompt: string,
      attachments: ChatAttachment[] = [],
      options: {
        assetIds?: string[]
        deckId?: string | null
        editorSelection?: EditorSelectionContext
        editorSelections?: EditorSelectionContext[]
        slideContexts?: SlideContext[]
        themeSelection?: ThemeSelectionContext
      } = {},
    ) =>
      generateDeckTurn(rawPrompt, attachments, options, {
        chat: { messages, appendMessage, reloadChat, setMessages },
        deckId,
        generatedHtml,
        generatedHtmlRef,
        isGenerating,
        canGenerate,
        refreshActiveDeck,
        startGeneration,
        onError,
        onGenerationStart,
        onGenerationSucceeded,
        setGenerationError,
      }),
    [
      appendMessage,
      canGenerate,
      deckId,
      generatedHtml,
      isGenerating,
      messages,
      onError,
      onGenerationStart,
      onGenerationSucceeded,
      refreshActiveDeck,
      reloadChat,
      setGenerationError,
      setMessages,
      startGeneration,
    ],
  )

  const handleCancelGeneration = useCallback(async () => {
    try {
      await cancelGeneration()
      toast.info('Canceling generation…')
    } catch {
      toast.error('Could not cancel generation')
    }
  }, [cancelGeneration])

  const handleRetryGeneration = useCallback(
    async () =>
      retryGenerationTurn({
        chat: { appendMessage, reloadChat, setMessages },
        deckId,
        generatedHtmlRef,
        refreshActiveDeck,
        retryGeneration,
        onError,
        onGenerationSucceeded,
      }),
    [
      appendMessage,
      deckId,
      onError,
      onGenerationSucceeded,
      refreshActiveDeck,
      reloadChat,
      retryGeneration,
      setMessages,
    ],
  )

  return {
    cancelGeneration: handleCancelGeneration,
    failedJobId,
    generateDeck,
    generationError: modelFailure ? '' : generationError,
    isPreviewUpdating,
    isModelFailure: modelFailure,
    isGenerating,
    recentGenerationJobId:
      activeJob?.status === 'succeeded' &&
      documentRevision !== null &&
      activeJob.result?.documentRevision === documentRevision
        ? activeJob.id
        : null,
    retryGeneration: handleRetryGeneration,
  }
}
