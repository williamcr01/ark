import type { ChatAttachment, EditorSelectionContext, SlideContext } from '@ark/chat/chat.ts'

/**
 * A user send parked while a generation turn is in flight.
 *
 * No Backend change: generation jobs are start/poll/cancel/retry only. Queued
 * sends flush-on-idle through the normal client send path (`generateDeck`),
 * not mid-turn steer.
 */
export type QueuedChatSend = {
  id: string
  text: string
  attachments: ChatAttachment[]
  assetIds: string[]
  deckId?: string | null
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  slideContexts?: SlideContext[]
}

export type QueuedChatSendPreview = {
  id: string
  text: string
  attachmentCount: number
}

export function toQueuedChatSendPreview(item: QueuedChatSend): QueuedChatSendPreview {
  return {
    id: item.id,
    text: item.text,
    attachmentCount: item.attachments.length,
  }
}
