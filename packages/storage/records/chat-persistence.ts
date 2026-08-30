import {
  buildAssistantMessageContent,
  type ApiChatMessage,
  type ChatMessagePart,
} from '@ark/chat/chat.ts'
import { projectAssistantTurnForPersistence } from '@ark/chat/chat-context.ts'
import type {
  GenerationJob,
  GenerationJobError,
  GenerationJobStatus,
} from '@ark/chat/generation-job.ts'
import { formatModelGenerationFailure, isModelGenerationError } from '@ark/chat/generation-job.ts'
import type { ChatStore } from './chat-record.ts'
import type { DeckStore } from './deck-record.ts'

export async function ensureChatThreadForJob(
  chatStore: ChatStore,
  deckStore: DeckStore,
  deckId: string,
) {
  const deck = await deckStore.getDeck(deckId)

  if (!deck) {
    return null
  }

  return chatStore.getOrCreateActiveThread(deckId)
}

export async function persistLatestUserMessage(
  chatStore: ChatStore,
  deckId: string,
  messages: ApiChatMessage[],
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
    context: lastUserMessage.context,
  })
}

export function formatTerminalGenerationChatContent(options: {
  status: GenerationJobStatus
  steps: GenerationJob['progress']['steps']
  assistantText?: string | null
  editingExistingDeck: boolean
  error?: GenerationJobError | null
  validationNote?: string
}) {
  const assistantContent =
    options.status === 'succeeded'
      ? buildAssistantMessageContent(
          options.assistantText ?? '',
          options.steps,
          options.editingExistingDeck,
        )
      : ''
  const validationNote = options.validationNote ?? ''

  if (assistantContent) {
    return `${assistantContent}${validationNote}`
  }

  if (options.status === 'canceled') {
    return `Generation canceled. ${options.error?.message ?? 'Generation was canceled.'}`
  }

  if (options.status === 'failed') {
    return isModelGenerationError(options.error)
      ? formatModelGenerationFailure(options.error?.message ?? 'Generation failed.')
      : `I could not generate the deck yet. ${options.error?.message ?? 'Generation failed.'}`
  }

  return options.editingExistingDeck
    ? `Updated the HTML deck and refreshed the preview.${validationNote}`
    : `Generated a complete self-contained HTML slide deck.${validationNote}`
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
    error?: GenerationJobError | null
    validationNote?: string
  },
) {
  const content = formatTerminalGenerationChatContent(options)
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
) {
  for (const message of messages) {
    await chatStore.appendMessage(deckId, {
      id: message.id,
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      context: message.role === 'user' ? message.context : undefined,
      parts: message.role === 'assistant' ? message.parts : undefined,
    })
  }
}
