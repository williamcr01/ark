import {
  applyResolvedAssetAttachments,
  collectAssetIdsFromMessages,
  isReadableTextMediaType,
} from '@ark/chat/chat.ts'
import type { ApiChatMessage, ChatAttachment } from '@ark/chat/chat.ts'
import { buildArkAssetUrl } from '@ark/deck/document/assets.ts'
import { resolveAssetAttachments } from '@ark/storage/records/asset-resolve.ts'
import { type AssetRecord } from '@ark/storage/records/asset-record.ts'
import type { DeckAttachmentInspector } from '../tools.ts'
import type { JobContext } from './context.ts'

export type JobAttachments = {
  modelMessages: ApiChatMessage[]
  attachmentInspector: DeckAttachmentInspector | undefined
}

/**
 * Build model-facing messages with resolved asset bytes. Prior user turns keep
 * their referenced files; the latest turn also receives any extra `assetIds`
 * selected for this job.
 */
export function prepareMessagesForModel(
  messages: ApiChatMessage[],
  resolvedById: ReadonlyMap<string, ChatAttachment>,
  latestTurnAssetIds: readonly string[],
): ApiChatMessage[] {
  const withHistory = applyResolvedAssetAttachments(messages, resolvedById)

  if (latestTurnAssetIds.length === 0) {
    return withHistory
  }

  const lastUserIndex = withHistory.map((message) => message.role).lastIndexOf('user')

  if (lastUserIndex === -1) {
    return withHistory
  }

  return withHistory.map((message, index) => {
    if (index !== lastUserIndex) {
      return message
    }

    const existing = message.attachments ?? []
    const existingAssetIds = new Set(
      existing.map((attachment) => attachment.assetId).filter(Boolean),
    )
    const extras = latestTurnAssetIds
      .map((id) => resolvedById.get(id))
      .filter((attachment): attachment is ChatAttachment => Boolean(attachment))
      .filter((attachment) => !existingAssetIds.has(attachment.assetId))

    if (extras.length === 0) {
      return message
    }

    return { ...message, attachments: [...existing, ...extras] }
  })
}

export async function resolveJobAttachments(ctx: JobContext): Promise<JobAttachments> {
  const currentJob = ctx.job
  let modelMessages = currentJob.request.messages
  let attachmentInspector: DeckAttachmentInspector | undefined
  const historyAssetIds = collectAssetIdsFromMessages(currentJob.request.messages)
  const latestTurnAssetIds = currentJob.assetIds ?? []
  const allAssetIds = [...new Set([...historyAssetIds, ...latestTurnAssetIds])]
  const assetStore = ctx.stores.assetStore

  if (allAssetIds.length === 0 || !assetStore) {
    return { modelMessages, attachmentInspector }
  }

  const resolved = await resolveAssetAttachments({ assetStore }, currentJob.deckId, allAssetIds)

  if (!resolved.ok) {
    return { modelMessages, attachmentInspector }
  }

  const records = (
    await Promise.all(
      allAssetIds.map(async (id) =>
        currentJob.deckId ? assetStore.getAsset(currentJob.deckId, id) : null,
      ),
    )
  ).filter((record): record is AssetRecord => Boolean(record?.deckId === currentJob.deckId))
  const recordsById = new Map(records.map((record) => [record.id, record]))
  attachmentInspector = {
    attachments: records.map((record) => ({
      id: record.id,
      filename: record.filename,
      mediaType: record.mediaType,
      byteSize: record.byteSize,
      url: buildArkAssetUrl(record.id),
    })),
    read: async (id) => {
      const record = recordsById.get(id)
      return record && currentJob.deckId ? assetStore.readBytes(currentJob.deckId, record.id) : null
    },
  }
  const modelAttachments = new Map(
    [...resolved.byId].map(([id, attachment]) => {
      const record = recordsById.get(id)
      return [
        id,
        record && isReadableTextMediaType(record.mediaType)
          ? {
              ...attachment,
              url: buildArkAssetUrl(id),
            }
          : attachment,
      ]
    }),
  )
  modelMessages = prepareMessagesForModel(
    currentJob.request.messages,
    modelAttachments,
    latestTurnAssetIds,
  )

  return { modelMessages, attachmentInspector }
}
