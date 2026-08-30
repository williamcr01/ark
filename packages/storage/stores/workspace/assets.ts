/** Asset reference tracking and grace-period garbage collection inside a workspace file. */

import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { EmbeddedAsset } from '../../records/embedded-assets.ts'

const ASSET_GC_GRACE_MS = 60_000

export function syncDocumentAssetReferences(database: DatabaseSync, html: string) {
  const ids = [
    ...new Set(
      [...html.matchAll(/ark-asset:([0-9a-f-]{36})/gi)].map((match) => match[1]!.toLowerCase()),
    ),
  ]
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
