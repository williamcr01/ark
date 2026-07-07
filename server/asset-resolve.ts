import type { ChatAttachment } from '../shared/chat.ts'
import { isValidAssetId } from '../shared/assets.ts'
import { isValidDeckId } from '../shared/api/index.ts'
import { type AssetStorage } from './asset-storage.ts'
import { type AssetStore } from './asset-record.ts'

export type ResolveAssetAttachmentsResult =
  | {
      ok: true
      attachments: ChatAttachment[]
      byId: ReadonlyMap<string, ChatAttachment>
    }
  | { ok: false; assetIds: string[] }

export type ResolveAssetAttachmentsOptions = {
  /** When true, missing or cross-deck ids are reported instead of skipped. */
  strict?: boolean
}

/**
 * Resolve uploaded asset ids into inline `data:` URL attachments for a
 * generation run. Only assets scoped to the given deck are resolved, keeping
 * chat history lightweight (references) while giving the model the bytes.
 */
export async function resolveAssetAttachments(
  deps: { assetStore: AssetStore; assetStorage: AssetStorage },
  deckId: string | null,
  assetIds: readonly string[],
  options: ResolveAssetAttachmentsOptions = {},
): Promise<ResolveAssetAttachmentsResult> {
  const empty = { ok: true as const, attachments: [], byId: new Map<string, ChatAttachment>() }

  if (!deckId || !isValidDeckId(deckId) || assetIds.length === 0) {
    return empty
  }

  const attachments: ChatAttachment[] = []
  const byId = new Map<string, ChatAttachment>()
  const seen = new Set<string>()
  const unresolved: string[] = []

  for (const rawId of assetIds) {
    const id = rawId.trim()

    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)

    if (!isValidAssetId(id)) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const record = await deps.assetStore.getAsset(id)

    if (!record || record.deckId !== deckId) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const bytes = await deps.assetStorage.read(record.storageKey)

    if (!bytes) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const dataUrl = `data:${record.mediaType};base64,${bytes.toString('base64')}`

    const attachment: ChatAttachment = {
      type: 'file',
      mediaType: record.mediaType,
      url: dataUrl,
      assetId: record.id,
      ...(record.filename ? { filename: record.filename } : {}),
    }

    attachments.push(attachment)
    byId.set(record.id, attachment)
  }

  if (options.strict && unresolved.length > 0) {
    return { ok: false, assetIds: unresolved }
  }

  return { ok: true, attachments, byId }
}
