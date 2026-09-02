import { useCallback, useEffect, useRef } from 'react'

import { toast } from 'sonner'

import type {
  ChatAttachment,
  EditorSelectionContext,
  SlideContext,
  ThemeSelectionContext,
} from '@ark/chat/chat.ts'
import type { ReasoningEffort } from '@ark/contracts'
import { isModelGenerationError } from '@ark/chat/generation-job.ts'
import { useChatStore } from '@/state/chat-store.ts'

import { useGenerationJob, type GenerationJobOutcome } from './useGenerationJob'
import {
  appendFailureChatMessage,
  applySucceededOutcome,
  generateDeckTurn,
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
    activeJob,
    activeSteps,
    cancelGeneration,
    error: generationError,
    failedJob,
    isGenerating,
    retryGeneration,
    resumeStoredJob,
    setError: setGenerationError,
    startGeneration,
    status: generationStatus,
  } = useGenerationJob({
    deckId,
    baseDocumentRevision: documentRevision,
    selectedModel,
    reasoningEffort,
    canGenerate,
    onReloadModels: loadModels,
  })

  const isPreviewUpdating = useChatStore((state) => state.isPreviewUpdating)
  const recoveredJobIdsRef = useRef(new Set<string>())
  const generatedHtmlRef = useRef(generatedHtml)
  const modelFailure = useChatStore((state) => state.isModelFailure)

  useEffect(() => {
    generatedHtmlRef.current = generatedHtml
  }, [generatedHtml])

  const applySucceeded = useCallback(
    async (outcome: Extract<GenerationJobOutcome, { status: 'succeeded' }>) =>
      applySucceededOutcome(outcome, {
        chat: { messages, appendMessage, reloadChat, setMessages },
        deckId,
        generatedHtmlRef,
        refreshActiveDeck,
        onGenerationSucceeded,
      }),
    [appendMessage, deckId, onGenerationSucceeded, refreshActiveDeck, reloadChat, setMessages],
  )

  useEffect(() => {
    if (isDeckLoading) {
      return
    }

    let cancelled = false

    void (async () => {
      const outcome = await resumeStoredJob()

      if (cancelled || !outcome) {
        return
      }

      if (outcome.status === 'succeeded') {
        if (recoveredJobIdsRef.current.has(outcome.job.id)) {
          return
        }

        recoveredJobIdsRef.current.add(outcome.job.id)
        await applySucceeded(outcome)
        return
      }

      const isModelFailure =
        outcome.status === 'failed' && isModelGenerationError(outcome.job.error)
      useChatStore.getState().setModelFailure(isModelFailure)

      if (deckId) {
        await reloadChat(deckId)
      } else {
        await appendFailureChatMessage(
          outcome.status,
          outcome.message,
          isModelFailure,
          { messages, appendMessage, reloadChat, setMessages },
          deckId,
        )
      }

      if (!isModelFailure) {
        onError(outcome.message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applySucceeded, deckId, isDeckLoading, onError, reloadChat, resumeStoredJob, setMessages])

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
        chat: { messages, appendMessage, reloadChat, setMessages },
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
    activeJobId: activeJob?.id ?? null,
    activeSteps,
    cancelGeneration: handleCancelGeneration,
    failedJobId: failedJob?.id ?? null,
    generateDeck,
    generationError: modelFailure ? '' : generationError,
    generationStatus,
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
