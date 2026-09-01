/** Asset reference tracking and grace-period garbage collection inside a workspace file. */

import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { EmbeddedAsset } from '../../records/embedded-assets.ts'

const ASSET_GC_GRACE_MS = 60_000

export function arkAssetIdsFromHtml(html: string) {
  return [
    ...new Set(
      [...html.matchAll(/ark-asset:([0-9a-f-]{36})/gi)].map((match) => match[1]!.toLowerCase()),
    ),
  ]
}

export function syncDocumentAssetReferences(database: DatabaseSync, html: string) {
  const ids = arkAssetIdsFromHtml(html)
  for (const id of ids) {
    if (!database.prepare('SELECT 1 FROM assets WHERE id = ?').get(id)) {
      throw new Error(`Unknown Ark asset: ${id}`)
    }
  }
  database.prepare("DELETE FROM asset_references WHERE owner_type = 'document'").run()
  const insert = database.prepare(
    `INSERT INTO asset_references
     (asset_id, owner_type, owner_id, purpose) VALUES (?, 'document', '1', 'embedded')`,
  )
  for (const id of ids) insert.run(id)
}

/**
 * Pin `ark-asset:` ids in a history snapshot so GC cannot delete blobs restore
 * still needs. Missing assets are skipped (the live document already rejected
 * unknown ids); eviction drops these pins.
 */
export function pinHistoryAssetReferences(database: DatabaseSync, revision: number, html: string) {
  const ownerId = String(revision)
  dropHistoryAssetReferences(database, revision)
  const insert = database.prepare(
    `INSERT INTO asset_references
     (asset_id, owner_type, owner_id, purpose)
     SELECT id, 'history', ?, 'snapshot' FROM assets WHERE id = ?`,
  )
  for (const id of arkAssetIdsFromHtml(html)) insert.run(ownerId, id)
}

export function dropHistoryAssetReferences(database: DatabaseSync, revision: number) {
  database
    .prepare("DELETE FROM asset_references WHERE owner_type = 'history' AND owner_id = ?")
    .run(String(revision))
}

export function garbageCollectUnreferencedAssets(database: DatabaseSync) {
  const cutoff = new Date(Date.now() - ASSET_GC_GRACE_MS).toISOString()
  database
    .prepare(
      `
    DELETE FROM assets
    WHERE NOT EXISTS (
      SELECT 1 FROM asset_references WHERE asset_references.asset_id = assets.id
    ) AND created_at <= ?
  `,
    )
    .run(cutoff)
  database.exec(`
    DELETE FROM blobs
    WHERE NOT EXISTS (
      SELECT 1 FROM assets WHERE assets.blob_checksum = blobs.checksum
    );
  `)
}

export function insertEmbeddedAssets(database: DatabaseSync, assets: readonly EmbeddedAsset[]) {
  const now = new Date().toISOString()
  for (const asset of assets) {
    const checksum = createHash('sha256').update(asset.bytes).digest('hex')
    database
      .prepare(
        `INSERT OR IGNORE INTO blobs
         (checksum, media_type, byte_size, bytes, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(checksum, asset.mediaType, asset.bytes.byteLength, asset.bytes, now)
    database
      .prepare(
        `INSERT INTO assets
         (id, blob_checksum, filename, media_type, category, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(asset.id, checksum, asset.filename, asset.mediaType, asset.category, asset.source, now)
  }
}
