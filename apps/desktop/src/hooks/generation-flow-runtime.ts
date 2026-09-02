import { toast } from 'sonner'

import type {
  ChatAttachment,
  ChatMessage,
  EditorSelectionContext,
  SlideContext,
  ThemeSelectionContext,
} from '@ark/chat/chat.ts'
import type { DeckValidationReport } from '@ark/deck/validate/document.ts'
import { formatModelGenerationFailure, isModelGenerationError } from '@ark/chat/generation-job.ts'
import { withEditorSelectionJobFields } from '@/lib/editor/editor-selection-context'
import { describeDeckValidation } from '@/lib/deck/deck-io'
import { newId } from '@/lib/ui/id'
import { useChatStore } from '@/state/chat-store.ts'

import type { GenerationJobOutcome } from './generation-job-runtime.ts'

export type GenerationHistoryChange = {
  beforeHtml: string
  afterHtml: string
  deckChanged: boolean
}

export type GenerationFlowChat = {
  messages: ChatMessage[]
  appendMessage: (message: ChatMessage, targetDeckId?: string | null) => Promise<void>
  reloadChat: (targetDeckId?: string | null) => Promise<ChatMessage[]>
  setMessages: (update: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
}

export function readRefreshedDeckHtml(value: unknown): string | null {
  if (value && typeof value === 'object' && 'html' in value) {
    const html = (value as { html?: unknown }).html
    return typeof html === 'string' ? html : null
  }
  return null
}

export function formatGenerationFailureMessage(
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

export function buildSucceededAssistantMessage(
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
    id: outcome.job.id,
    role: 'assistant',
    content,
    parts: assistantParts.length > 0 ? assistantParts : undefined,
  }
}

export async function appendFailureChatMessage(
  status: 'failed' | 'canceled',
  message: string,
  isModelFailure: boolean,
  chat: GenerationFlowChat,
  deckId: string | null,
) {
  const failureMessage: ChatMessage = {
    id: newId(),
    role: 'assistant',
    content: formatGenerationFailureMessage(status, message, isModelFailure),
  }

  if (deckId) {
    await chat.appendMessage(failureMessage)
    return
  }

  chat.setMessages((current) => {
    const last = current.at(-1)
    if (last?.role === 'assistant' && last.content === failureMessage.content) {
      return current
    }

    return [...current, failureMessage]
  })
}

export async function applySucceededOutcome(
  outcome: Extract<GenerationJobOutcome, { status: 'succeeded' }>,
  options: {
    chat: GenerationFlowChat
    deckId: string | null
    generatedHtmlRef: { current: string }
    refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
    onGenerationSucceeded?: (change: GenerationHistoryChange) => void
  },
) {
  useChatStore.getState().setModelFailure(false)

  if (outcome.awaitingUserResponse) {
    if (options.deckId) {
      await options.chat.reloadChat(options.deckId)
      return
    }

    const assistantMessage = buildSucceededAssistantMessage(outcome)
    options.chat.setMessages((current) => {
      if (current.some((message) => message.id === assistantMessage.id)) {
        return current
      }

      return [...current, assistantMessage]
    })
    return
  }

  const assistantMessage = buildSucceededAssistantMessage(outcome)
  options.chat.setMessages((current) => {
    if (current.some((message) => message.id === assistantMessage.id)) {
      return current
    }

    return [...current, assistantMessage]
  })

  const beforeHtml = options.generatedHtmlRef.current
  if (outcome.deckChanged) {
    useChatStore.getState().setPreviewUpdating(true)
  }

  let refreshedHtml: string | null = null
  let refreshFailed = false
  try {
    const refreshed = await options.refreshActiveDeck(outcome.job.result?.deckId)
    refreshedHtml = readRefreshedDeckHtml(refreshed)
  } catch {
    refreshFailed = true
  } finally {
    useChatStore.getState().setPreviewUpdating((current) => (outcome.deckChanged ? false : current))
  }

  const afterHtml = refreshedHtml ?? beforeHtml
  const deckChanged = Boolean(outcome.deckChanged && afterHtml !== beforeHtml)

  options.onGenerationSucceeded?.({
    beforeHtml,
    afterHtml,
    deckChanged,
  })

  if (refreshFailed) {
    toast.error('Deck generated but could not be refreshed in the editor')
    return
  }

  toast.success(outcome.job.editingExistingDeck ? 'Deck updated' : 'Deck generated')
}

export async function generateDeckTurn(
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
  context: {
    chat: GenerationFlowChat
    deckId: string | null
    generatedHtml: string
    generatedHtmlRef: { current: string }
    isGenerating: boolean
    canGenerate: boolean
    refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
    startGeneration: (
      messages: ChatMessage[],
      currentHtml: string,
      options: {
        assetIds?: string[]
        deckId?: string | null
        editorSelection?: EditorSelectionContext
        editorSelections?: EditorSelectionContext[]
        slideContexts?: SlideContext[]
      },
    ) => Promise<GenerationJobOutcome | null>
    onError: (message: string) => void
    onGenerationStart?: () => void
    onGenerationSucceeded?: (change: GenerationHistoryChange) => void
    setGenerationError: (message: string) => void
  },
) {
  const prompt =
    rawPrompt.trim() ||
    (attachments.length > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

  if ((!prompt && attachments.length === 0) || context.isGenerating || !context.canGenerate) {
    return
  }

  context.onError('')
  useChatStore.getState().setModelFailure(false)
  context.setGenerationError('')
  context.onGenerationStart?.()
  const selectionFields = withEditorSelectionJobFields({
    editorSelection: options.editorSelection,
    editorSelections: options.editorSelections,
  })
  const { themeSelection: _themeSelection, ...jobSource } = options
  const jobOptions = {
    ...jobSource,
    ...selectionFields,
  }
  const messageContext =
    selectionFields.editorSelection ||
    selectionFields.editorSelections?.length ||
    options.slideContexts?.length ||
    options.themeSelection
      ? {
          ...selectionFields,
          ...(options.slideContexts?.length ? { slideContexts: options.slideContexts } : {}),
          ...(options.themeSelection ? { themeSelection: options.themeSelection } : {}),
        }
      : undefined
  const userMessage: ChatMessage = {
    id: newId(),
    role: 'user',
    content: rawPrompt.trim(),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(messageContext ? { context: messageContext as ChatMessage['context'] } : {}),
  }
  const nextMessages: ChatMessage[] = [...context.chat.messages, userMessage]
  const resolvedDeckId = options.deckId ?? context.deckId

  if (resolvedDeckId) {
    await context.chat.appendMessage(userMessage, resolvedDeckId)
  } else {
    context.chat.setMessages(nextMessages)
  }

  try {
    const outcome = await context.startGeneration(nextMessages, context.generatedHtml, {
      ...jobOptions,
      deckId: resolvedDeckId,
    })

    if (!outcome) {
      return
    }

    if (outcome.status === 'succeeded') {
      await applySucceededOutcome(outcome, context)
      return
    }

    const message = outcome.message
    const isModelFailure = outcome.status === 'failed' && isModelGenerationError(outcome.job.error)
    useChatStore.getState().setModelFailure(isModelFailure)
    if (!isModelFailure) {
      context.onError(message)
    }

    if (resolvedDeckId) {
      await context.chat.reloadChat(resolvedDeckId)
    } else {
      await appendFailureChatMessage(
        outcome.status,
        message,
        isModelFailure,
        context.chat,
        context.deckId,
      )
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
    useChatStore.getState().setModelFailure(isModelFailure)

    if (isModelFailure) {
      await appendFailureChatMessage('failed', message, true, context.chat, context.deckId)
    } else {
      context.onError(message)
      if (resolvedDeckId) {
        await context.chat.reloadChat(resolvedDeckId)
      } else {
        await appendFailureChatMessage('failed', message, false, context.chat, context.deckId)
      }
      toast.error('Generation failed')
    }
  }
}

export async function retryGenerationTurn(context: {
  chat: GenerationFlowChat
  deckId: string | null
  generatedHtmlRef: { current: string }
  refreshActiveDeck: (targetDeckId?: string) => Promise<unknown>
  retryGeneration: () => Promise<GenerationJobOutcome | null>
  onError: (message: string) => void
  onGenerationSucceeded?: (change: GenerationHistoryChange) => void
}) {
  try {
    const outcome = await context.retryGeneration()

    if (!outcome) {
      return
    }

    if (outcome.status === 'succeeded') {
      await applySucceededOutcome(outcome, context)
      return
    }

    const message = outcome.message
    const isModelFailure = outcome.status === 'failed' && isModelGenerationError(outcome.job.error)
    useChatStore.getState().setModelFailure(isModelFailure)
    if (!isModelFailure) {
      context.onError(message)
    }

    if (context.deckId) {
      await context.chat.reloadChat()
    } else {
      await appendFailureChatMessage(
        outcome.status,
        message,
        isModelFailure,
        context.chat,
        context.deckId,
      )
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
    useChatStore.getState().setModelFailure(isModelFailure)

    if (isModelFailure) {
      await appendFailureChatMessage('failed', message, true, context.chat, context.deckId)
    } else {
      toast.error('Could not retry generation')
    }
  }
}
