import type { ChatAttachment } from '@ark/chat/attachments.ts'

import { uploadDeckAsset } from '@/lib/api/asset-api'

export type PromptSubmitFile = {
  filename?: string
  mediaType: string
  url: string
}

export type PromptSubmitMessage = {
  text: string
  files: PromptSubmitFile[]
}

export async function uploadPromptAttachments(
  deckId: string,
  files: PromptSubmitFile[],
): Promise<ChatAttachment[]> {
  const attachments = new Array<ChatAttachment>(files.length)
  let nextIndex = 0

  async function uploadNext(): Promise<void> {
    const index = nextIndex
    nextIndex += 1
    const file = files[index]
    if (!file) return

    const asset = await uploadDeckAsset(deckId, {
      filename: file.filename ?? 'attachment',
      mediaType: file.mediaType,
      data: file.url,
    })
    attachments[index] = {
      type: 'file',
      mediaType: asset.mediaType,
      filename: asset.filename,
      url: asset.url,
      assetId: asset.id,
    }
    await uploadNext()
  }

  const workerCount = Math.min(3, files.length)
  await Promise.all(Array.from({ length: workerCount }, uploadNext))
  return attachments
}
