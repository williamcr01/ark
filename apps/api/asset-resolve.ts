import type { ChatAttachment } from '@ark/deck-core/chat.ts'
import { isValidAssetId } from '@ark/deck/document/assets.ts'
import { isValidDeckId } from '@ark/contracts'
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

/** Inline canonical `ark-asset:` references for sandbox rendering and export. */
export async function resolveArkAssetUrls(assetStore: AssetStore, deckId: string, html: string) {
  const ids = [
    ...new Set(
      [...html.matchAll(/ark-asset:([0-9a-f-]{36})/gi)].map((match) => match[1]!.toLowerCase()),
    ),
  ]
  let resolved = html
  for (const id of ids) {
    const record = await assetStore.getAsset(deckId, id)
    const bytes = record ? await assetStore.readBytes(deckId, id) : null
    if (!record || !bytes) throw new Error(`Unknown Ark asset: ${id}`)
    const dataUrl = `data:${record.mediaType};base64,${bytes.toString('base64')}`
    resolved = resolved.replaceAll(new RegExp(`ark-asset:${id}`, 'gi'), dataUrl)
  }
  return resolved
}

/**
 * Resolve uploaded asset ids into inline `data:` URL attachments for a
 * generation run. Only assets scoped to the given deck are resolved, keeping
 * chat history lightweight (references) while giving the model the bytes.
 */
export async function resolveAssetAttachments(
  deps: { assetStore: AssetStore },
  deckId: string | null,
  assetIds: readonly string[],
  options: ResolveAssetAttachmentsOptions = {},
): Promise<ResolveAssetAttachmentsResult> {
  const empty = { ok: true as const, attachments: [], byId: new Map<string, ChatAttachment>() }

  if ((deckId !== null && !isValidDeckId(deckId)) || assetIds.length === 0) {
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

    const record = deckId ? await deps.assetStore.getAsset(deckId, id) : null

    if (!record || record.deckId !== deckId) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const bytes = await deps.assetStore.readBytes(deckId!, record.id)

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
