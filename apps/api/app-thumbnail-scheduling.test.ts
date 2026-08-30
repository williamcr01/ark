import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createApp } from './app.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import type { ThumbnailService } from './thumbnails/service.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Thumbnail timing</title></head>
<body><section class="slide"><h1>Hello</h1></section></body>
</html>`

function createThumbnailServiceSpy() {
  const enqueueForDocument = vi.fn().mockResolvedValue(undefined)
  const service = {
    isAvailable: () => true,
    getStatus: vi.fn().mockResolvedValue({ status: 'ready', slides: [] }),
    enqueue: vi.fn().mockResolvedValue({ status: 'ready', slides: [] }),
    readPng: vi.fn().mockResolvedValue(null),
    enqueueForDocument,
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThumbnailService

  return { service, enqueueForDocument }
}

describe('thumbnail scheduling around document persistence', () => {
  it('defers editor patch warming but not generic document writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-thumbnail-scheduling-'))
    const { service, enqueueForDocument } = createThumbnailServiceSpy()
    const server: Server = createApp({
      deckStore: createDeckStore(root),
      thumbnailService: service,
    }).listen(0)

    try {
      await new Promise<void>((resolve) => server.once('listening', resolve))
      const address = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${address.port}`
      const createResponse = await fetch(`${baseUrl}/api/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: sampleHtml }),
      })
      const created = await createResponse.json()
      const deckId = created.deck.id as string

      expect(enqueueForDocument).toHaveBeenCalledTimes(1)

      const updateResponse = await fetch(`${baseUrl}/api/decks/${deckId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: sampleHtml.replace('Hello', 'Updated'),
          expectedDocumentRevision: 1,
        }),
      })
      expect(updateResponse.status).toBe(200)
      expect(enqueueForDocument).toHaveBeenCalledTimes(2)

      const patchResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedDocumentRevision: 2,
          operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'Patched' }],
        }),
      })
      expect(patchResponse.status).toBe(200)
      expect(enqueueForDocument).toHaveBeenCalledTimes(2)

      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(enqueueForDocument).toHaveBeenCalledTimes(3)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      await rm(root, { recursive: true, force: true })
    }
  })
})
