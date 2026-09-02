import { describe, expect, it } from 'vitest'

import { toQueuedChatSendPreview, type QueuedChatSend } from './chat-send-queue'

describe('toQueuedChatSendPreview', () => {
  it('projects id, text, and attachment count for composer chips', () => {
    const item: QueuedChatSend = {
      id: 'q1',
      text: 'make it darker',
      attachments: [
        {
          type: 'file',
          filename: 'notes.pdf',
          mediaType: 'application/pdf',
          url: 'ark-asset:a1',
          assetId: 'a1',
        },
        {
          type: 'file',
          filename: 'chart.png',
          mediaType: 'image/png',
          url: 'ark-asset:a2',
          assetId: 'a2',
        },
      ],
      assetIds: ['a1', 'a2'],
      deckId: 'deck-1',
    }

    expect(toQueuedChatSendPreview(item)).toEqual({
      id: 'q1',
      text: 'make it darker',
      attachmentCount: 2,
    })
  })
})
