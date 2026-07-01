import { describe, expect, it } from 'vitest'

import { createMemoryPostgresPool } from '../test-utils.ts'
import { createPostgresDeckStore } from './decks.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Quarterly Review</title>
</head>
<body>
  <section class="slide"><h1>Hello</h1></section>
</body>
</html>`

describe('createPostgresDeckStore', () => {
  it('creates, reads, lists, versions, and soft-deletes decks', async () => {
    const pool = createMemoryPostgresPool()
    const store = createPostgresDeckStore({ pool })

    try {
      const created = await store.createDeck(sampleHtml)

      expect(created.title).toBe('Quarterly Review')
      expect(created.versionNumber).toBe(1)
      expect(created.activeVersionId).toBeTruthy()

      const loaded = await store.getDeck(created.id)
      expect(loaded?.html).toBe(sampleHtml)

      const updatedHtml = sampleHtml
        .replace('Quarterly Review', 'Board Review')
        .replace('Hello', 'Updated')
      const updated = await store.updateDeck(created.id, updatedHtml)

      expect(updated?.title).toBe('Board Review')
      expect(updated?.html).toContain('Updated')
      expect(updated?.versionNumber).toBe(2)
      expect(updated?.activeVersionId).not.toBe(created.activeVersionId)

      const versions = await pool.query<{ version_number: number; html: string }>(
        `
          SELECT version_number, html
          FROM deck_versions
          WHERE deck_id = $1
          ORDER BY version_number ASC
        `,
        [created.id],
      )

      expect(versions.rows).toHaveLength(2)
      expect(versions.rows[0].html).toBe(sampleHtml)
      expect(versions.rows[1].html).toBe(updatedHtml)

      const decks = await store.listDecks()
      expect(decks).toHaveLength(1)
      expect(decks[0]).toMatchObject({
        id: created.id,
        title: 'Board Review',
        versionNumber: 2,
      })
      expect('html' in decks[0]).toBe(false)

      expect(await store.deleteDeck(created.id)).toBe(true)
      expect(await store.getDeck(created.id)).toBeNull()
      expect(await store.listDecks()).toEqual([])

      const deletedRow = await pool.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM decks WHERE id = $1',
        [created.id],
      )

      expect(deletedRow.rows[0].deleted_at).toBeInstanceOf(Date)
    } finally {
      await pool.end?.()
    }
  })

  it('rejects invalid deck ids before querying Postgres', async () => {
    const pool = createMemoryPostgresPool()
    const store = createPostgresDeckStore({ pool })

    try {
      expect(await store.getDeck('../escape')).toBeNull()
      expect(await store.updateDeck('missing-id', sampleHtml)).toBeNull()
      expect(await store.deleteDeck('../../etc/passwd')).toBe(false)
    } finally {
      await pool.end?.()
    }
  })
})
