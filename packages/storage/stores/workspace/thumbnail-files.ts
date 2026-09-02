/** Thumbnail blobs stored inside an `.ark` workspace file. */

import type { DatabaseSync } from 'node:sqlite'

import type { RecentList } from './recent-list.ts'

export class ThumbnailFiles {
  constructor(
    private readonly databaseFor: (id: string) => Promise<DatabaseSync | null>,
    private readonly recents: RecentList,
  ) {}

  async readThumbnail(
    id: string,
    slideHash: string,
    rendererVersion: string,
    manifestHash: string,
  ) {
    const database = await this.databaseFor(id)
    if (!database) return null
    const row = database
      .prepare(
        `SELECT media_type, width, height, image FROM thumbnails
         WHERE slide_hash = ? AND renderer_version = ? AND manifest_hash = ?`,
      )
      .get(slideHash, rendererVersion, manifestHash) as
      { media_type: string; width: number; height: number; image: Uint8Array } | undefined
    return row
      ? {
          mediaType: row.media_type,
          width: row.width,
          height: row.height,
          image: Buffer.from(row.image),
        }
      : null
  }

  async writeThumbnail(
    id: string,
    input: {
      slideHash: string
      rendererVersion: string
      manifestHash: string
      mediaType: string
      width: number
      height: number
      image: Buffer
      cover?: boolean
    },
  ) {
    const database = await this.databaseFor(id)
    if (!database) return false
    database
      .prepare(
        `INSERT INTO thumbnails
         (slide_hash, renderer_version, manifest_hash, media_type, width, height, image, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slide_hash, renderer_version, manifest_hash) DO UPDATE SET
           media_type = excluded.media_type,
           width = excluded.width,
           height = excluded.height,
           image = excluded.image,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.slideHash,
        input.rendererVersion,
        input.manifestHash,
        input.mediaType,
        input.width,
        input.height,
        input.image,
        new Date().toISOString(),
      )
    if (input.cover) {
      const recent = this.recents.get(id)
      if (recent) {
        recent.cover = `data:${input.mediaType};base64,${input.image.toString('base64')}`
        await this.recents.persist()
      }
    }
    return true
  }

  async pruneThumbnails(
    id: string,
    slideHashes: readonly string[],
    rendererVersion: string,
    manifestHash: string,
  ) {
    const database = await this.databaseFor(id)
    if (!database) return false
    if (slideHashes.length === 0) {
      database.prepare('DELETE FROM thumbnails').run()
      return true
    }
    database
      .prepare(
        `DELETE FROM thumbnails
         WHERE renderer_version != ? OR manifest_hash != ?
            OR slide_hash NOT IN (${slideHashes.map(() => '?').join(', ')})`,
      )
      .run(rendererVersion, manifestHash, ...slideHashes)
    return true
  }
}
