import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAssetStore } from '../asset-store.ts'
import { createDeckStore } from '../deck-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from '../workspace-store.ts'
import type { ThumbnailRenderer } from './renderer.ts'
import { createThumbnailService, thumbnailManifestHash, type ThumbnailService } from './service.ts'

const html = `<!DOCTYPE html><html><head><title>Thumbs</title></head><body><section class="slide">One</section><section class="slide">Two</section></body></html>`

describe('workspace thumbnail service', () => {
  let directory = ''
  let workspaces: WorkspaceStore | null = null
  let service: ThumbnailService | null = null

  afterEach(async () => {
    await service?.close()
    workspaces?.close()
    service = null
    workspaces = null
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  async function setup(renderer: ThumbnailRenderer) {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ark-thumbnails-'))
    workspaces = createWorkspaceStore(directory)
    const deckStore = createDeckStore(workspaces)
    service = createThumbnailService({
      renderer,
      deckStore,
      workspaceStore: workspaces,
      assetStore: createAssetStore(workspaces),
    })
    const deck = await deckStore.createDeck(html)
    return { deck, deckStore, service }
  }

  it('renders missing slides and stores ready PNGs in the .ark database', async () => {
    const render = vi.fn(async (request) => ({
      ok: true as const,
      slides: (request.slideIndexes ?? [0, 1]).map((index) => Buffer.from(`png-${index}`)),
      slideCount: 2,
      width: 480,
      height: 270,
      durationMs: 1,
    }))
    const { deck, service } = await setup({
      isAvailable: () => true,
      close: async () => undefined,
      render,
    })
    const manifestHash = thumbnailManifestHash(deck.html)
    const result = await service.getStatus({
      deckId: deck.id,
      documentRevision: deck.documentRevision,
      manifestHash,
      html: deck.html,
      enqueueIfMissing: true,
      waitMs: 1_000,
    })

    expect(result).toMatchObject({ status: 'ready', slides: [{ index: 0 }, { index: 1 }] })
    await expect(
      service.readPng({
        deckId: deck.id,
        documentRevision: deck.documentRevision,
        manifestHash,
        slideIndex: 0,
      }),
    ).resolves.toEqual(Buffer.from('png-0'))
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('renders only changed slide hashes after a document update', async () => {
    const render = vi.fn(async (request) => ({
      ok: true as const,
      slides: (request.slideIndexes ?? []).map((index) => Buffer.from(`png-${index}`)),
      slideCount: 2,
      width: 480,
      height: 270,
      durationMs: 1,
    }))
    const { deck, deckStore, service } = await setup({
      isAvailable: () => true,
      close: async () => undefined,
      render,
    })
    const manifestHash = thumbnailManifestHash(deck.html)
    await service.getStatus({
      deckId: deck.id,
      documentRevision: 1,
      manifestHash,
      html: deck.html,
      enqueueIfMissing: true,
      waitMs: 1_000,
    })
    const updated = (await deckStore.updateDeck(deck.id, html.replace('Two', 'Changed')))!
    await service.getStatus({
      deckId: deck.id,
      documentRevision: 2,
      manifestHash: thumbnailManifestHash(updated.html),
      html: updated.html,
      enqueueIfMissing: true,
      waitMs: 1_000,
    })

    expect(render).toHaveBeenNthCalledWith(2, expect.objectContaining({ slideIndexes: [1] }))
  })

  it('reports renderer failures without crashing the queue', async () => {
    const { deck, service } = await setup({
      isAvailable: () => true,
      close: async () => undefined,
      render: async () => ({ ok: false, error: 'capture failed', durationMs: 1 }),
    })
    await expect(
      service.getStatus({
        deckId: deck.id,
        documentRevision: 1,
        manifestHash: thumbnailManifestHash(deck.html),
        html: deck.html,
        enqueueIfMissing: true,
        waitMs: 1_000,
      }),
    ).resolves.toMatchObject({ status: 'failed', error: 'capture failed' })
  })

  it('disables thumbnail work when no renderer is available', async () => {
    const { deck, service } = await setup({
      isAvailable: () => false,
      close: async () => undefined,
      render: async () => ({ ok: false, error: 'disabled', durationMs: 0 }),
    })
    await expect(
      service.getStatus({
        deckId: deck.id,
        documentRevision: 1,
        manifestHash: thumbnailManifestHash(deck.html),
        html: deck.html,
      }),
    ).resolves.toEqual({ status: 'disabled', slides: [] })
  })
})
