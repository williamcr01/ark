import { useCallback, useEffect, useRef } from 'react'

import type {
  AgentStep,
  ChatMessage,
  EditorSelectionContext,
  SlideContext,
} from '@ark/chat/chat.ts'
import type { GenerationJobStatus } from '@ark/contracts'
import { useChatStore } from '@/state/chat-store.ts'

import {
  cancelActiveGeneration,
  clearStoredGenerationJob,
  resumeStoredGenerationJob,
  retryFailedGeneration,
  startTrackedGeneration,
  type GenerationJobOutcome,
  type UseGenerationJobOptions,
} from './generation-job-runtime.ts'

export { clearStoredGenerationJob }
export type { GenerationJobOutcome, UseGenerationJobOptions }

export function useGenerationJob({
  deckId,
  baseDocumentRevision,
  selectedModel,
  reasoningEffort,
  canGenerate,
  onReloadModels,
}: UseGenerationJobOptions) {
  const pollAbortRef = useRef<AbortController | null>(null)
  const deckKey = deckId ?? 'new'
  const activeJob = useChatStore((state) => state.activeJob)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const error = useChatStore((state) => state.generationError)
  const failedJob = useChatStore((state) => state.failedJob)
  const setError = useChatStore((state) => state.setGenerationError)

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }, [])

  const startGeneration = useCallback(
    async (
      messages: ChatMessage[],
      currentHtml: string,
      options: {
        assetIds?: string[]
        deckId?: string | null
        editorSelection?: EditorSelectionContext
        editorSelections?: EditorSelectionContext[]
        slideContexts?: SlideContext[]
      } = {},
    ) =>
      startTrackedGeneration(
        messages,
        currentHtml,
        options,
        {
          deckId,
          baseDocumentRevision,
          selectedModel,
          reasoningEffort,
          canGenerate,
          onReloadModels,
        },
        pollAbortRef,
      ),
    [baseDocumentRevision, canGenerate, deckId, onReloadModels, reasoningEffort, selectedModel],
  )

  const cancelGeneration = useCallback(async () => cancelActiveGeneration(), [])

  const retryGeneration = useCallback(
    async (jobId?: string) =>
      retryFailedGeneration(jobId, pollAbortRef, deckKey, baseDocumentRevision, onReloadModels),
    [baseDocumentRevision, deckKey, onReloadModels],
  )

  const resumeStoredJob = useCallback(
    async () =>
      resumeStoredGenerationJob(deckKey, pollAbortRef, baseDocumentRevision, onReloadModels),
    [baseDocumentRevision, deckKey, onReloadModels],
  )

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  return {
    activeJob,
    activeSteps: (activeJob?.progress.steps ?? []) as AgentStep[],
    cancelGeneration,
    error,
    failedJob,
    isGenerating,
    retryGeneration,
    resumeStoredJob,
    setError,
    startGeneration,
    status: (activeJob?.status ?? null) as GenerationJobStatus | null,
  }
}
