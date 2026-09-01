import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { toast } from 'sonner'

import type {
  ChatAttachment,
  ChatMessage,
  EditorSelectionContext,
  SlideContext,
} from '@ark/chat/chat.ts'
import type { DeckValidationReport } from '@ark/deck/validate/document.ts'
import { formatModelGenerationFailure, isModelGenerationError } from '@ark/chat/generation-job.ts'
import type { ReasoningEffort } from '@ark/contracts'
import { describeDeckValidation } from '@/lib/deck/deck-io'
import { newId } from '@/lib/ui/id'

import { useGenerationJob, type GenerationJobOutcome } from './useGenerationJob'

type DeckPersistenceSlice = {
  deckId: string | null
  documentRevision: number | null
  generatedHtml: string
  isDeckLoading: boolean
  refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
}

export type GenerationHistoryChange = {
  beforeHtml: string
  afterHtml: string
  deckChanged: boolean
}

function readRefreshedDeckHtml(value: unknown): string | null {
  if (value && typeof value === 'object' && 'html' in value) {
    const html = (value as { html?: unknown }).html
    return typeof html === 'string' ? html : null
  }
  return null
}

type ChatSessionSlice = {
  messages: ChatMessage[]
  appendMessage: (message: ChatMessage, targetDeckId?: string | null) => Promise<void>
  reloadChat: (targetDeckId?: string | null) => Promise<ChatMessage[]>
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
}

function formatGenerationFailureMessage(
  status: 'failed' | 'canceled',
  message: string,
  modelFailure: boolean,
) {
  if (status === 'canceled') {
    return `Generation canceled. ${message}`
  }

  return modelFailure
    ? formatModelGenerationFailure(message)
    : `I could not generate the deck yet. ${message}`
}

export type UseDeckGenerationFlowOptions = {
  deck: DeckPersistenceSlice
  chat: ChatSessionSlice
  selectedModel: string
  reasoningEffort?: ReasoningEffort
  canGenerate: boolean
  loadModels: () => Promise<void>
  /** Surfaces generation errors on the shell (kept separate from the job's own error). */
  onError: (message: string) => void
  /** Clears any pending attachment error when a new generation starts. */
  onGenerationStart?: () => void
  /**
   * Called after a successful generation that is not waiting on the user.
   * `deckChanged` stays true when the job wrote the deck even if refresh
   * fails, so the session undo stack can still record the agent-turn step.
   */
  onGenerationSucceeded?: (change: GenerationHistoryChange) => void
}

/**
 * Owns the deck generation lifecycle: starting a job, applying a succeeded
 * outcome (deck refresh + local assistant message), cancel, retry, and
 * pending-job recovery on mount. Extracted from `App.tsx` so the shell stays
 * thin; behavior is intended to be identical to the previous inline
 * implementation.
 */

function buildSucceededAssistantMessage(
  outcome: Extract<GenerationJobOutcome, { status: 'succeeded' }>,
): ChatMessage {
  const validation = outcome.job.result?.validation as DeckValidationReport | null | undefined
  const validationNote =
    validation && Array.isArray(validation.issues) && typeof validation.slideCount === 'number'
      ? ` Validation: ${describeDeckValidation(validation)}.`
      : ''
  const content = outcome.assistantContent
    ? `${outcome.assistantContent}${validationNote}`
    : `Generated a complete self-contained HTML slide deck.${validationNote}`
  const assistantParts = [...outcome.assistantParts]
  let existingText = ''

  for (const part of assistantParts) {
    if (part.type === 'text') {
      existingText += part.content + '\n'
    }
  }

  existingText = existingText.trim()
  const extraText = content.trim()

  if (extraText && extraText !== existingText && !existingText.endsWith(extraText)) {
    assistantParts.push({ type: 'text', content: extraText })
  }

  return {
    // Server persists the assistant turn under the job id — keep them aligned.
    id: outcome.job.id,
    role: 'assistant',
    content,
    parts: assistantParts.length > 0 ? assistantParts : undefined,
  }
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

  const [isPreviewUpdating, setIsPreviewUpdating] = useState(false)
  const recoveredJobIdsRef = useRef(new Set<string>())
  const generatedHtmlRef = useRef(generatedHtml)
  const [modelFailure, setModelFailure] = useState(false)

  useEffect(() => {
    generatedHtmlRef.current = generatedHtml
  }, [generatedHtml])

  const appendFailureChatMessage = useCallback(
    async (status: 'failed' | 'canceled', message: string, isModelFailure: boolean) => {
      const failureMessage: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: formatGenerationFailureMessage(status, message, isModelFailure),
      }

      if (deckId) {
        await appendMessage(failureMessage)
        return
      }

      setMessages((current) => {
        const last = current.at(-1)
        if (last?.role === 'assistant' && last.content === failureMessage.content) {
          return current
        }

        return [...current, failureMessage]
      })
    },
    [appendMessage, deckId, setMessages],
  )

  const applySucceededOutcome = useCallback(
    async (outcome: Extract<GenerationJobOutcome, { status: 'succeeded' }>) => {
      setModelFailure(false)

      if (outcome.awaitingUserResponse) {
        if (deckId) {
          await reloadChat(deckId)
          return
        }

        // New-deck ask_user / propose_themes: no server chat yet — land the
        // assistant turn locally so interactive UI can read tool input from parts.
        const assistantMessage = buildSucceededAssistantMessage(outcome)
        setMessages((current) => {
          if (current.some((message) => message.id === assistantMessage.id)) {
            return current
          }

          return [...current, assistantMessage]
        })
        return
      }

      // Land the assistant turn before deck refresh so the live bubble does not
      // disappear into an empty gap while the preview/deck id updates.
      const assistantMessage = buildSucceededAssistantMessage(outcome)
      setMessages((current) => {
        if (current.some((message) => message.id === assistantMessage.id)) {
          return current
        }

        return [...current, assistantMessage]
      })

      // Snapshot the deck as the shell last saw it, immediately before the
      // agent write lands in the refresh below. Taking it at send time instead
      // would fold any edit made during the job into the agent's undo step, and
      // would leave a recovered job (resumed after a reload, with no send in
      // this session) recording an empty `beforeHtml` that Undo would apply.
      const beforeHtml = generatedHtmlRef.current
      if (outcome.deckChanged) {
        setIsPreviewUpdating(true)
      }

      let refreshedHtml: string | null = null
      let refreshFailed = false
      try {
        const refreshed = await refreshActiveDeck(outcome.job.result?.deckId)
        refreshedHtml = readRefreshedDeckHtml(refreshed)
      } catch {
        refreshFailed = true
      } finally {
        setIsPreviewUpdating((current) => (outcome.deckChanged ? false : current))
      }

      // `refreshActiveDeck` resolves to null when the refresh was superseded by
      // a newer save or by a deck switch. The run still succeeded; there is
      // just no snapshot to record. Only a thrown refresh is a real failure.
      const afterHtml = refreshedHtml ?? beforeHtml
      const deckChanged = Boolean(outcome.deckChanged && afterHtml !== beforeHtml)

      onGenerationSucceeded?.({
        beforeHtml,
        afterHtml,
        deckChanged,
      })

      if (refreshFailed) {
        toast.error('Deck generated but could not be refreshed in the editor')
        return
      }

      toast.success(outcome.job.editingExistingDeck ? 'Deck updated' : 'Deck generated')
    },
    [deckId, onGenerationSucceeded, refreshActiveDeck, reloadChat, setMessages, setModelFailure],
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
        await applySucceededOutcome(outcome)
        return
      }

      const isModelFailure =
        outcome.status === 'failed' && isModelGenerationError(outcome.job.error)
      setModelFailure(isModelFailure)

      if (deckId) {
        await reloadChat(deckId)
      } else {
        await appendFailureChatMessage(outcome.status, outcome.message, isModelFailure)
      }

      if (!isModelFailure) {
        onError(outcome.message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    applySucceededOutcome,
    appendFailureChatMessage,
    deckId,
    isDeckLoading,
    onError,
    reloadChat,
    resumeStoredJob,
    setMessages,
    setModelFailure,
  ])

  const generateDeck = useCallback(
    async (
      rawPrompt: string,
      attachments: ChatAttachment[] = [],
      options: {
        assetIds?: string[]
        editorSelection?: EditorSelectionContext
        slideContexts?: SlideContext[]
      } = {},
    ) => {
      const prompt =
        rawPrompt.trim() ||
        (attachments.length > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

      if ((!prompt && attachments.length === 0) || isGenerating || !canGenerate) {
        return
      }

      onError('')
      setModelFailure(false)
      setGenerationError('')
      onGenerationStart?.()
      const messageContext =
        options.editorSelection || options.slideContexts?.length
          ? {
              ...(options.editorSelection ? { editorSelection: options.editorSelection } : {}),
              ...(options.slideContexts?.length ? { slideContexts: options.slideContexts } : {}),
            }
          : undefined
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: rawPrompt.trim(),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(messageContext ? { context: messageContext } : {}),
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
        const isModelFailure =
          outcome.status === 'failed' && isModelGenerationError(outcome.job.error)
        setModelFailure(isModelFailure)
        if (!isModelFailure) {
          onError(message)
        }

        if (deckId) {
          await reloadChat()
        } else {
          await appendFailureChatMessage(outcome.status, message, isModelFailure)
        }

        if (outcome.status === 'canceled') {
          toast.info('Generation canceled')
        } else if (outcome.job.error?.code === 'document_conflict') {
          toast.error('Deck changed during generation')
        } else if (!isModelFailure) {
          toast.error('Generation failed')
        }
      } catch (generationFailure) {
        const message =
          generationFailure instanceof Error
            ? generationFailure.message
            : 'Something went wrong while generating the deck.'

        const isModelFailure = isModelGenerationError(generationFailure)
        setModelFailure(isModelFailure)

        if (isModelFailure) {
          await appendFailureChatMessage('failed', message, true)
        } else {
          onError(message)
          if (deckId) {
            await reloadChat()
          } else {
            await appendFailureChatMessage('failed', message, false)
          }
          toast.error('Generation failed')
        }
      }
    },
    [
      appendMessage,
      applySucceededOutcome,
      appendFailureChatMessage,
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
      setModelFailure,
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
      const isModelFailure =
        outcome.status === 'failed' && isModelGenerationError(outcome.job.error)
      setModelFailure(isModelFailure)
      if (!isModelFailure) {
        onError(message)
      }

      if (deckId) {
        await reloadChat()
      } else {
        await appendFailureChatMessage(outcome.status, message, isModelFailure)
      }

      if (outcome.status === 'canceled') {
        toast.error('Generation canceled')
      } else if (!isModelFailure) {
        toast.error('Generation failed')
      }
    } catch (retryFailure) {
      const message =
        retryFailure instanceof Error ? retryFailure.message : 'Could not retry generation.'
      const isModelFailure = isModelGenerationError(retryFailure)
      setModelFailure(isModelFailure)

      if (isModelFailure) {
        await appendFailureChatMessage('failed', message, true)
      } else {
        toast.error('Could not retry generation')
      }
    }
  }, [
    appendFailureChatMessage,
    applySucceededOutcome,
    deckId,
    onError,
    reloadChat,
    retryGeneration,
    setModelFailure,
  ])

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
