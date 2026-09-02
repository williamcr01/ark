import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import {
  buildDeckRuntimeManifestFromHtml,
  hashRuntimeManifest,
} from '@ark/storage/fs/deck-manifest.ts'
import type { WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'
import type { AssetStore } from '@ark/storage/records/asset-record.ts'
import { THUMBNAIL_QUEUE_MAX_PENDING } from './constants.ts'
import { inspectThumbnailCoverage, renderMissingThumbnails } from './service-render.ts'
import type { ThumbnailRenderer } from './renderer.ts'
import {
  readThumbnailPng,
  resolveThumbnailStatus,
  type ThumbnailEnqueueInput,
  type ThumbnailStatusInput,
  type ThumbnailStatusResult,
} from './service-status.ts'

export type {
  ThumbnailEnqueueInput,
  ThumbnailStatusInput,
  ThumbnailStatusResult,
} from './service-status.ts'

export function thumbnailManifestHash(html: string) {
  return hashRuntimeManifest(buildDeckRuntimeManifestFromHtml(html))
}

export type ThumbnailService = {
  isAvailable: () => boolean
  getStatus: (input: ThumbnailStatusInput) => Promise<ThumbnailStatusResult>
  enqueue: (input: ThumbnailEnqueueInput) => Promise<ThumbnailStatusResult>
  readPng: (input: {
    deckId: string
    documentRevision: number
    manifestHash: string
    slideIndex: number
    fingerprint?: string
  }) => Promise<Buffer | null>
  enqueueForDocument: (deckId: string, documentRevision: number) => Promise<void>
  close: () => Promise<void>
}

export function createThumbnailService(options: {
  renderer: ThumbnailRenderer
  deckStore: DeckStore
  workspaceStore: WorkspaceStore
  assetStore: AssetStore
  queueMaxPending?: number
}): ThumbnailService {
  const jobs = new Map<string, Promise<void>>()
  const failures = new Map<string, string>()
  const maxPending = options.queueMaxPending ?? THUMBNAIL_QUEUE_MAX_PENDING
  let queue = Promise.resolve()
  let closed = false

  const key = (input: { deckId: string; documentRevision: number; manifestHash: string }) =>
    `${input.deckId}:${input.documentRevision}:${input.manifestHash}`

  const inspect = async (input: ThumbnailEnqueueInput) =>
    inspectThumbnailCoverage(options.workspaceStore, input)

  const render = async (input: ThumbnailEnqueueInput) =>
    renderMissingThumbnails({
      renderer: options.renderer,
      deckStore: options.deckStore,
      workspaceStore: options.workspaceStore,
      assetStore: options.assetStore,
      input,
      inspect,
      jobKey: key(input),
      failures,
    })

  const schedule = (input: ThumbnailEnqueueInput) => {
    const jobKey = key(input)
    const existing = jobs.get(jobKey)
    if (existing || closed || jobs.size >= maxPending) return existing ?? null
    const job = queue
      .then(() => render(input))
      .catch((error) => {
        failures.set(jobKey, error instanceof Error ? error.message : String(error))
      })
      .finally(() => jobs.delete(jobKey))
    jobs.set(jobKey, job)
    queue = job
    return job
  }

  const status = (input: Parameters<ThumbnailService['getStatus']>[0]) =>
    resolveThumbnailStatus({
      input,
      rendererAvailable: options.renderer.isAvailable(),
      inspect,
      schedule,
      failures,
      jobKey: key,
    })

  return {
    isAvailable: () => options.renderer.isAvailable(),
    getStatus: status,
    async enqueue(input) {
      schedule(input)
      return status({ ...input, enqueueIfMissing: false })
    },
    async readPng(input) {
      const deck = await options.deckStore.getDeck(input.deckId)
      if (!deck || deck.documentRevision !== input.documentRevision) return null
      return readThumbnailPng(options.workspaceStore, {
        html: deck.html,
        manifestHash: input.manifestHash,
        slideIndex: input.slideIndex,
        fingerprint: input.fingerprint,
        deckId: input.deckId,
      })
    },
    async enqueueForDocument(deckId, documentRevision) {
      const deck = await options.deckStore.getDeck(deckId)
      if (!deck || deck.documentRevision !== documentRevision) return
      schedule({
        deckId,
        documentRevision,
        html: deck.html,
        manifestHash: thumbnailManifestHash(deck.html),
      })
    },
    async close() {
      closed = true
      await queue
      await options.renderer.close()
    },
  }
}
