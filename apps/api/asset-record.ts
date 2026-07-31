import {
  type AssetCategory,
  type AssetMetadata,
  type AssetSource,
  buildAssetUrl,
  buildTemporaryAssetUrl,
  isValidAssetId,
} from '@ark/deck-core/assets.ts'

export type { AssetCategory, AssetMetadata, AssetSource }
export { isValidAssetId }

export type AssetRecord = {
  id: string
  deckId: string | null
  chatMessageId: string | null
  filename: string
  mediaType: string
  category: AssetCategory
  byteSize: number
  checksum: string
  source: AssetSource
  storageKind: string
  storageKey: string
  createdAt: string
  deletedAt: string | null
}

export type CreateAssetInput = {
  deckId: string | null
  chatMessageId?: string | null
  filename: string
  mediaType: string
  category: AssetCategory
  byteSize: number
  checksum: string
  source: AssetSource
  storageKind: string
  storageKey: string
}

/**
 * Metadata store for uploaded assets. Byte storage is handled separately by an
 * {@link AssetStorage} adapter; this interface only tracks metadata and the
 * opaque storage key that links a record to its bytes.
 */
export type AssetStore = {
  createAsset: (input: CreateAssetInput) => Promise<AssetRecord>
  getAsset: (id: string) => Promise<AssetRecord | null>
  listAssetsByDeck: (deckId: string) => Promise<AssetRecord[]>
  /** Assign every requested unowned asset to a deck, or return null without claiming any. */
  claimAssetsForDeck: (ids: readonly string[], deckId: string) => Promise<AssetRecord[] | null>
  /** Soft-delete unowned assets created before the cutoff. */
  deleteExpiredUnassignedAssets: (cutoff: string) => Promise<AssetRecord[]>
  /** Soft-delete a single asset, returning the record (incl. storage key) or null. */
  deleteAsset: (id: string) => Promise<AssetRecord | null>
  /** Soft-delete every asset for a deck (orphan cleanup on deck delete). */
  deleteAssetsByDeck: (deckId: string) => Promise<AssetRecord[]>
  /** Soft-delete every asset tied to a chat message (orphan cleanup). */
  deleteAssetsByChatMessage: (chatMessageId: string) => Promise<AssetRecord[]>
}

/** Convert a stored record into the public, client-facing metadata shape. */
export function toAssetMetadata(record: AssetRecord): AssetMetadata {
  return {
    id: record.id,
    deckId: record.deckId,
    chatMessageId: record.chatMessageId,
    filename: record.filename,
    mediaType: record.mediaType,
    category: record.category,
    byteSize: record.byteSize,
    checksum: record.checksum,
    source: record.source,
    storageKind: record.storageKind,
    url: record.deckId
      ? buildAssetUrl(record.deckId, record.id)
      : buildTemporaryAssetUrl(record.id),
    createdAt: record.createdAt,
  }
}
