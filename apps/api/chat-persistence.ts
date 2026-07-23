import {
  buildAssistantMessageContent,
  type ApiChatMessage,
  type ChatMessagePart,
} from '@ark/deck-core/chat.ts'
import { projectAssistantTurnForPersistence } from '@ark/deck-core/chat-context.ts'
import type {
  GenerationJob,
  GenerationJobError,
  GenerationJobStatus,
} from '@ark/deck-core/generation-job.ts'
import {
  formatModelGenerationFailure,
  isModelGenerationError,
} from '@ark/deck-core/generation-job.ts'
import type { ChatStore } from './chat-record.ts'
import type { DeckStore } from './deck-record.ts'

export async function ensureChatThreadForJob(
  chatStore: ChatStore,
  deckStore: DeckStore,
  deckId: string,
  baseVersionId: string | null,
) {
  const deck = await deckStore.getDeck(deckId)

  if (!deck) {
    return null
  }

  return chatStore.getOrCreateActiveThread(deckId, baseVersionId ?? deck.activeVersionId ?? null)
}

export async function persistLatestUserMessage(
  chatStore: ChatStore,
  deckId: string,
  messages: ApiChatMessage[],
  deckVersionId: string | null,
) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')

  if (!lastUserMessage) {
    return null
  }

  return chatStore.appendMessage(deckId, {
    id: lastUserMessage.id,
    role: 'user',
    content: lastUserMessage.content,
    attachments: lastUserMessage.attachments,
    deckVersionId,
  })
}

export async function persistAssistantGenerationMessage(
  chatStore: ChatStore,
  deckId: string,
  options: {
    jobId: string
    model: string
    status: GenerationJobStatus
    steps: GenerationJob['progress']['steps']
    transcriptParts?: ChatMessagePart[]
    assistantText?: string | null
    editingExistingDeck: boolean
    deckVersionId?: string | null
    error?: GenerationJobError | null
    validationNote?: string
  },
) {
  const assistantContent =
    options.status === 'succeeded'
      ? buildAssistantMessageContent(
          options.assistantText ?? '',
          options.steps,
          options.editingExistingDeck,
        )
      : ''
  const validationNote = options.validationNote ?? ''
  const content = assistantContent
    ? `${assistantContent}${validationNote}`
    : options.status === 'canceled'
      ? `Generation canceled. ${options.error?.message ?? 'Generation was canceled.'}`
      : options.status === 'failed'
        ? isModelGenerationError(options.error)
          ? formatModelGenerationFailure(options.error?.message ?? 'Generation failed.')
          : `I could not generate the deck yet. ${options.error?.message ?? 'Generation failed.'}`
        : options.editingExistingDeck
          ? `Updated the HTML deck and refreshed the preview.${validationNote}`
          : `Generated a complete self-contained HTML slide deck.${validationNote}`

  const assistantParts: ChatMessagePart[] = [...(options.transcriptParts ?? [])]
  const persistedText = assistantParts
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .join('\n')
    .trim()
  const extraText = content.trim()
  if (extraText && extraText !== persistedText && !persistedText.endsWith(extraText)) {
    const lastStep = assistantParts.reduce((max, part) => Math.max(max, part.stepIndex ?? -1), -1)
    assistantParts.push({ type: 'text', content: extraText, stepIndex: lastStep + 1 })
  }
  const persistedParts = projectAssistantTurnForPersistence(assistantParts)

  return chatStore.appendMessage(deckId, {
    id: options.jobId,
    role: 'assistant',
    content,
    parts: persistedParts.length > 0 ? persistedParts : undefined,
    deckVersionId: options.deckVersionId ?? null,
    generationJobId: options.jobId,
    generationStatus: options.status,
    model: options.model,
    error: options.error
      ? {
          message: options.error.message,
          code: options.error.code ?? null,
        }
      : null,
  })
}

export async function persistInitialDeckChatHistory(
  chatStore: ChatStore,
  deckId: string,
  messages: ApiChatMessage[],
  deckVersionId: string | null,
) {
  for (const message of messages) {
    await chatStore.appendMessage(deckId, {
      id: message.id,
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      parts: message.role === 'assistant' ? message.parts : undefined,
      deckVersionId,
    })
  }
}
