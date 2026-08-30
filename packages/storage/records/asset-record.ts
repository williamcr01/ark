import type { AssetCategory, AssetMetadata, AssetSource } from '@ark/deck/document/assets.ts'
import { buildAssetUrl, isValidAssetId } from '@ark/deck/document/assets.ts'

export type { AssetCategory, AssetMetadata, AssetSource }
export { isValidAssetId }

export type AssetRecord = {
  id: string
  deckId: string
  chatMessageId: string | null
  filename: string
  mediaType: string
  category: AssetCategory
  byteSize: number
  checksum: string
  source: AssetSource
  createdAt: string
}

export type CreateAssetInput = {
  deckId: string
  chatMessageId?: string | null
  filename: string
  mediaType: string
  category: AssetCategory
  source: AssetSource
  bytes: Buffer
}

export type AssetStore = {
  createAsset: (input: CreateAssetInput) => Promise<AssetRecord>
  getAsset: (deckId: string, id: string) => Promise<AssetRecord | null>
  readBytes: (deckId: string, id: string) => Promise<Buffer | null>
  listAssetsByDeck: (deckId: string) => Promise<AssetRecord[]>
  addReference: (
    deckId: string,
    assetId: string,
    ownerType: 'document' | 'message',
    ownerId: string,
    purpose: string,
  ) => Promise<boolean>
  deleteAsset: (deckId: string, id: string) => Promise<AssetRecord | null>
}

export function toAssetMetadata(record: AssetRecord): AssetMetadata {
  return {
    ...record,
    storageKind: 'sqlite',
    url: buildAssetUrl(record.deckId, record.id),
  }
}
