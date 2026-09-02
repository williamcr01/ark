import { describe, expect, it, vi } from 'vitest'

import { submitPromptMessage } from './submit-prompt-message.ts'

describe('submitPromptMessage', () => {
  it('blocks attachments on a text-only model', async () => {
    const setAttachmentError = vi.fn()
    const generateDeck = vi.fn()

    await submitPromptMessage(
      {
        text: 'Use this',
        files: [
          { filename: 'hero.avif', mediaType: 'image/avif', url: 'data:image/avif;base64,AA' },
        ],
      },
      {
        canGenerate: true,
        catalog: [{ id: 'text', name: 'Text Model', supportsAttachments: false }],
        selectedModel: 'text',
        deckId: 'deck-1',
        html: '<html></html>',
        ensureBlankDeck: vi.fn(),
        isGenerating: false,
        editorSelection: null,
        editorSelections: [],
        contextSlideEntries: [],
        setAttachmentError,
        setInput: vi.fn(),
        enqueue: vi.fn(),
        generateDeck,
      },
    )

    expect(setAttachmentError).toHaveBeenCalledWith(
      'Text Model is text-only and does not support attachments.',
    )
    expect(generateDeck).not.toHaveBeenCalled()
  })
})
