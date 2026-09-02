import { useCallback } from 'react'

import type { ChatAttachment } from '@ark/chat/chat.ts'
import { toast } from 'sonner'

import {
  generateDeckTurn,
  retryGenerationTurn,
  type GenerationFlowChat,
  type GenerationHistoryChange,
} from './generation-flow-runtime.ts'

type GenerateDeckTurnContext = Parameters<typeof generateDeckTurn>[3]

export function useDeckGenerationActions(args: {
  chat: GenerationFlowChat
  deckId: string | null
  generatedHtml: string
  generatedHtmlRef: { current: string }
  isGenerating: boolean
  canGenerate: boolean
  refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
  startGeneration: GenerateDeckTurnContext['startGeneration']
  retryGeneration: () => Promise<Awaited<ReturnType<GenerateDeckTurnContext['startGeneration']>>>
  cancelGeneration: () => Promise<unknown>
  onError: (message: string) => void
  onGenerationStart?: () => void
  onGenerationSucceeded?: (change: GenerationHistoryChange) => void
  setGenerationError: (message: string) => void
}) {
  const generateDeck = useCallback(
    (
      rawPrompt: string,
      attachments: ChatAttachment[] = [],
      options: Parameters<typeof generateDeckTurn>[2] = {},
    ) =>
      generateDeckTurn(rawPrompt, attachments, options, {
        chat: args.chat,
        deckId: args.deckId,
        generatedHtml: args.generatedHtml,
        generatedHtmlRef: args.generatedHtmlRef,
        isGenerating: args.isGenerating,
        canGenerate: args.canGenerate,
        refreshActiveDeck: args.refreshActiveDeck,
        startGeneration: args.startGeneration,
        onError: args.onError,
        onGenerationStart: args.onGenerationStart,
        onGenerationSucceeded: args.onGenerationSucceeded,
        setGenerationError: args.setGenerationError,
      }),
    [args],
  )

  const handleCancelGeneration = useCallback(async () => {
    try {
      await args.cancelGeneration()
      toast.info('Canceling generation…')
    } catch {
      toast.error('Could not cancel generation')
    }
  }, [args])

  const handleRetryGeneration = useCallback(
    () =>
      retryGenerationTurn({
        chat: args.chat,
        deckId: args.deckId,
        generatedHtmlRef: args.generatedHtmlRef,
        refreshActiveDeck: args.refreshActiveDeck,
        retryGeneration: args.retryGeneration,
        onError: args.onError,
        onGenerationSucceeded: args.onGenerationSucceeded,
      }),
    [args],
  )

  return { generateDeck, handleCancelGeneration, handleRetryGeneration }
}
