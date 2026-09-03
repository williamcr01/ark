import type { ReasoningEffort } from '@ark/contracts'
import { useChatStore, selectFailedJobId } from '@/state/chat-store.ts'

import { useGenerationJob } from './useGenerationJob'
import { useGenerationOutcomeRecovery } from './useGenerationOutcomeRecovery.ts'
import { useDeckGenerationActions } from './useDeckGenerationActions.ts'
import { type GenerationFlowChat, type GenerationHistoryChange } from './generation-flow-runtime.ts'

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
  const modelFailure = useChatStore((state) => state.isModelFailure)
  const failedJobId = useChatStore(selectFailedJobId)

  const generatedHtmlRef = useGenerationOutcomeRecovery({
    isDeckLoading,
    deckId,
    chat,
    generatedHtml,
    refreshActiveDeck,
    resumeStoredJob,
    onError,
    onGenerationSucceeded,
  })

  const { generateDeck, handleCancelGeneration, handleRetryGeneration } = useDeckGenerationActions({
    chat,
    deckId,
    generatedHtml,
    generatedHtmlRef,
    isGenerating,
    canGenerate,
    refreshActiveDeck,
    startGeneration,
    retryGeneration,
    cancelGeneration,
    onError,
    onGenerationStart,
    onGenerationSucceeded,
    setGenerationError,
  })

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
