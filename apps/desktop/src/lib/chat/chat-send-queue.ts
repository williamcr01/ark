import type { ChatAttachment, EditorSelectionContext, SlideContext } from '@ark/chat/chat.ts'

/**
 * A user send parked while a generation turn is in flight.
 *
 * Generation jobs have no steer/append endpoint — `POST /api/generation-jobs`
 * starts a new job, and the only in-flight control is cancel. Queued sends
 * therefore flush as the next turn once the current job is no longer active.
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
