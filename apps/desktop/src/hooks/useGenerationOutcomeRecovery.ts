import { useEffect, useRef } from 'react'

import {
  recoverStoredGenerationOutcome,
  type GenerationFlowChat,
  type GenerationHistoryChange,
} from './generation-flow-runtime.ts'
import type { GenerationJobOutcome } from './generation-job-runtime.ts'

export function useGenerationOutcomeRecovery(args: {
  isDeckLoading: boolean
  deckId: string | null
  chat: GenerationFlowChat
  generatedHtml: string
  refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
  resumeStoredJob: () => Promise<GenerationJobOutcome | null | undefined>
  onError: (message: string) => void
  onGenerationSucceeded?: (change: GenerationHistoryChange) => void
}) {
  const {
    isDeckLoading,
    deckId,
    chat,
    generatedHtml,
    refreshActiveDeck,
    resumeStoredJob,
    onError,
    onGenerationSucceeded,
  } = args
  const { appendMessage, reloadChat, setMessages } = chat
  const recoveredJobIdsRef = useRef(new Set<string>())
  const generatedHtmlRef = useRef(generatedHtml)

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

  return generatedHtmlRef
}
