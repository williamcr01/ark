import { useCallback, useEffect, useRef } from 'react'

import type { ChatMessage } from '@ark/chat/messages.ts'
import type { EditorSelectionContext, SlideContext } from '@ark/chat/context.ts'
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
    cancelGeneration,
    retryGeneration,
    resumeStoredJob,
    setError,
    startGeneration,
  }
}
