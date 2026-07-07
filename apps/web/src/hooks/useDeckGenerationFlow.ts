import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

import { toast } from 'sonner'

import type { ChatAttachment, ChatMessage } from '@ark/deck-core/chat.ts'
import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'
import { describeDeckValidation } from '@/lib/deck-io'
import { newId } from '@/lib/id'

import { useGenerationJob, type GenerationJobOutcome } from './useGenerationJob'

type DeckPersistenceSlice = {
  deckId: string | null
  activeVersionId: string | null
  generatedHtml: string
  isDeckLoading: boolean
  refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
}

type ChatSessionSlice = {
  messages: ChatMessage[]
  appendMessage: (message: ChatMessage, targetDeckId?: string | null) => Promise<void>
  reloadChat: (targetDeckId?: string | null) => Promise<ChatMessage[]>
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
}

export type UseDeckGenerationFlowOptions = {
  deck: DeckPersistenceSlice
  chat: ChatSessionSlice
  selectedModel: string
  canGenerate: boolean
  loadModels: () => Promise<void>
  /** Surfaces generation errors on the shell (kept separate from the job's own error). */
  onError: (message: string) => void
  /** Clears any pending attachment error when a new generation starts. */
  onGenerationStart?: () => void
  /** Called when generation succeeds and the deck is about to be refreshed. */
  onGenerationSucceeded?: () => void
}

/**
 * Owns the deck generation lifecycle: starting a job, applying a succeeded
 * outcome (deck refresh + chat reload), cancel, retry, and pending-job recovery
 * on mount. Extracted from `App.tsx` so the shell stays thin; behavior is
 * intended to be identical to the previous inline implementation.
 */
export function useDeckGenerationFlow({
  deck,
  chat,
  selectedModel,
  canGenerate,
  loadModels,
  onError,
  onGenerationStart,
  onGenerationSucceeded,
}: UseDeckGenerationFlowOptions) {
  const { deckId, activeVersionId, generatedHtml, isDeckLoading, refreshActiveDeck } = deck
  const { messages, appendMessage, reloadChat, setMessages } = chat

  const {
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
    baseVersionId: activeVersionId,
    selectedModel,
    canGenerate,
    onReloadModels: loadModels,
  })

  const recoveredJobIdsRef = useRef(new Set<string>())

  const applySucceededOutcome = useCallback(
    async (outcome: Extract<GenerationJobOutcome, { status: 'succeeded' }>) => {
      onGenerationSucceeded?.()

      try {
        await refreshActiveDeck(outcome.job.result?.deckId)
      } catch {
        toast.error('Deck generated but could not be refreshed in the editor')
      }

      const targetDeckId = outcome.job.result?.deckId ?? deckId

      if (targetDeckId) {
        await reloadChat(targetDeckId)
      } else {
        const validationNote = outcome.job.result?.validation
          ? ` Validation: ${describeDeckValidation(outcome.job.result.validation as DeckValidationReport)}.`
          : ''
        const assistantParts = [
          ...outcome.assistantParts,
          ...(outcome.assistantContent
            ? [
                {
                  type: 'text' as const,
                  content: `${outcome.assistantContent}${validationNote}`,
                },
              ]
            : validationNote
              ? [{ type: 'text' as const, content: validationNote.trim() }]
              : []),
        ]

        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: outcome.assistantContent
              ? `${outcome.assistantContent}${validationNote}`
              : `Generated a complete self-contained HTML slide deck.${validationNote}`,
            parts: assistantParts.length > 0 ? assistantParts : undefined,
          },
        ])
      }

      toast.success(outcome.job.editingExistingDeck ? 'Deck updated' : 'Deck generated')
    },
    [deckId, onGenerationSucceeded, refreshActiveDeck, reloadChat, setMessages],
  )

  useEffect(() => {
    if (isDeckLoading) {
      return
    }

    void (async () => {
      const outcome = await resumeStoredJob()

      if (!outcome) {
        return
      }

      if (outcome.status === 'succeeded') {
        if (recoveredJobIdsRef.current.has(outcome.job.id)) {
          return
        }

        recoveredJobIdsRef.current.add(outcome.job.id)
        await applySucceededOutcome(outcome)
        return
      }

      if (deckId) {
        await reloadChat(deckId)
      } else {
        setMessages((current) => {
          const failedContent =
            outcome.status === 'canceled'
              ? `Generation canceled. ${outcome.message}`
              : `I could not generate the deck yet. ${outcome.message}`
          const last = current.at(-1)

          if (last?.role === 'assistant' && last.content === failedContent) {
            return current
          }

          return [
            ...current,
            {
              id: newId(),
              role: 'assistant' as const,
              content: failedContent,
            },
          ]
        })
      }

      onError(outcome.message)
    })()
  }, [
    applySucceededOutcome,
    deckId,
    isDeckLoading,
    onError,
    reloadChat,
    resumeStoredJob,
    setMessages,
  ])

  const generateDeck = useCallback(
    async (
      rawPrompt: string,
      attachments: ChatAttachment[] = [],
      options: { assetIds?: string[] } = {},
    ) => {
      const prompt =
        rawPrompt.trim() ||
        (attachments.length > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

      if ((!prompt && attachments.length === 0) || isGenerating || !canGenerate) {
        return
      }

      onError('')
      setGenerationError('')
      onGenerationStart?.()
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: rawPrompt.trim(),
        ...(attachments.length > 0 ? { attachments } : {}),
      }
      const nextMessages: ChatMessage[] = [...messages, userMessage]

      if (deckId) {
        await appendMessage(userMessage)
      } else {
        setMessages(nextMessages)
      }

      try {
        const outcome = await startGeneration(nextMessages, generatedHtml, options)

        if (!outcome) {
          return
        }

        if (outcome.status === 'succeeded') {
          await applySucceededOutcome(outcome)
          return
        }

        const message = outcome.message
        onError(message)

        if (deckId) {
          await reloadChat()
        } else {
          setMessages((current) => [
            ...current,
            {
              id: newId(),
              role: 'assistant',
              content:
                outcome.status === 'canceled'
                  ? `Generation canceled. ${message}`
                  : `I could not generate the deck yet. ${message}`,
            },
          ])
        }

        if (outcome.status === 'canceled') {
          toast.info('Generation canceled')
        } else if (outcome.job.error?.code === 'version_conflict') {
          toast.error('Deck changed during generation')
        } else {
          toast.error('Generation failed')
        }
      } catch (generationFailure) {
        const message =
          generationFailure instanceof Error
            ? generationFailure.message
            : 'Something went wrong while generating the deck.'

        onError(message)

        if (deckId) {
          await reloadChat()
        } else {
          setMessages((current) => [
            ...current,
            {
              id: newId(),
              role: 'assistant',
              content: `I could not generate the deck yet. ${message}`,
            },
          ])
        }
        toast.error('Generation failed')
      }
    },
    [
      appendMessage,
      applySucceededOutcome,
      canGenerate,
      deckId,
      generatedHtml,
      isGenerating,
      messages,
      onError,
      onGenerationStart,
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

  const handleRetryGeneration = useCallback(async () => {
    try {
      const outcome = await retryGeneration()

      if (!outcome) {
        return
      }

      if (outcome.status === 'succeeded') {
        await applySucceededOutcome(outcome)
        return
      }

      const message = outcome.message
      onError(message)

      if (deckId) {
        await reloadChat()
      }

      toast.error(outcome.status === 'canceled' ? 'Generation canceled' : 'Generation failed')
    } catch {
      toast.error('Could not retry generation')
    }
  }, [applySucceededOutcome, deckId, onError, reloadChat, retryGeneration])

  return {
    activeSteps,
    cancelGeneration: handleCancelGeneration,
    failedJobId: failedJob?.id ?? null,
    generateDeck,
    generationError,
    generationStatus,
    isGenerating,
    retryGeneration: handleRetryGeneration,
  }
}
