import { describe, expect, it, vi } from 'vitest'

import { uploadPromptAttachments } from './upload-prompt-attachments.ts'

const { uploadDeckAsset } = vi.hoisted(() => ({
  uploadDeckAsset: vi.fn(),
}))

vi.mock('@/lib/api/asset-api', () => ({
  uploadDeckAsset,
}))

describe('uploadPromptAttachments', () => {
  it('uploads files in original order with bounded concurrency', async () => {
    const seen: string[] = []
    uploadDeckAsset.mockImplementation(async (_deckId: string, input: { filename: string }) => {
      seen.push(input.filename)
      return {
        id: `id-${input.filename}`,
        mediaType: 'image/png',
        filename: input.filename,
        url: `/assets/${input.filename}`,
      }
    })

    const attachments = await uploadPromptAttachments('deck-1', [
      { filename: 'a.png', mediaType: 'image/png', url: 'data:a' },
      { filename: 'b.png', mediaType: 'image/png', url: 'data:b' },
      { filename: 'c.png', mediaType: 'image/png', url: 'data:c' },
      { filename: 'd.png', mediaType: 'image/png', url: 'data:d' },
    ])

    expect(attachments.map((item) => item.filename)).toEqual(['a.png', 'b.png', 'c.png', 'd.png'])
    expect(seen).toHaveLength(4)
  })
})
