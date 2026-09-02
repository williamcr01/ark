import { describe, expect, it } from 'vitest'

import { prepareMessagesForModel, resolveJobAttachments } from './attachments.ts'
import {
  ASSET_ID,
  createMemoryAssetStore,
  createTestContext,
  createTestDeps,
  DECK_ID,
  jobSnapshot,
  memoryAsset,
} from './test-support.ts'

describe('prepareMessagesForModel', () => {
  it('appends latest-turn assets onto the last user message only', () => {
    const attachment = {
      type: 'file' as const,
      mediaType: 'text/plain',
      url: 'data:text/plain;base64,YQ==',
      assetId: ASSET_ID,
      filename: 'notes.txt',
    }
    const messages = prepareMessagesForModel(
      [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'use the notes' },
      ],
      new Map([[ASSET_ID, attachment]]),
      [ASSET_ID],
    )

    expect(messages[0]?.attachments).toBeUndefined()
    expect(messages[2]?.attachments).toEqual([attachment])
  })
})

describe('resolveJobAttachments', () => {
  it('leaves messages unchanged when there are no assets', async () => {
    const ctx = createTestContext()
    const resolved = await resolveJobAttachments(ctx)

    expect(resolved.modelMessages).toEqual(ctx.job.request.messages)
    expect(resolved.attachmentInspector).toBeUndefined()
  })

  it('builds an inspector and model attachments for workspace assets', async () => {
    const asset = memoryAsset()
    const assetStore = createMemoryAssetStore([asset])
    const ctx = createTestContext(
      createTestDeps({ assetStore }),
      jobSnapshot({
        deckId: DECK_ID,
        assetIds: [ASSET_ID],
        request: {
          messages: [{ role: 'user', content: 'Use the notes' }],
          currentHtml: '',
        },
      }),
    )

    const resolved = await resolveJobAttachments(ctx)

    expect(resolved.attachmentInspector?.attachments).toEqual([
      expect.objectContaining({ id: ASSET_ID, filename: 'notes.txt', mediaType: 'text/plain' }),
    ])
    expect(JSON.stringify(resolved.modelMessages)).toContain(ASSET_ID)
    await expect(resolved.attachmentInspector!.read(ASSET_ID)).resolves.toEqual(asset.bytes)
  })
})
