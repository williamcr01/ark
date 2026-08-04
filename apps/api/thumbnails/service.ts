import { THUMBNAIL_LONG_POLL_MAX_WAIT_MS } from '@ark/contracts'
import type { DeckStore } from '../deck-record.ts'
import { buildDeckRuntimeManifestFromHtml, hashRuntimeManifest } from '../deck-manifest.ts'
import type { WorkspaceStore } from '../workspace-store.ts'
import type { AssetStore } from '../asset-record.ts'
import { resolveArkAssetUrls } from '../asset-resolve.ts'
import {
  THUMBNAIL_MAX_SLIDES,
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_QUEUE_MAX_PENDING,
  THUMBNAIL_RENDERER_VERSION,
  THUMBNAIL_STATUS,
  type ThumbnailStatus,
} from './constants.ts'
import { computeThumbnailSlideFingerprints } from './fingerprints.ts'
import type { ThumbnailRenderer } from './renderer.ts'

export type ThumbnailStatusResult = {
  status: ThumbnailStatus
  slides: Array<{ index: number; url: string }>
  error?: string
  width?: number
  height?: number
}

export type ThumbnailEnqueueInput = {
  deckId: string
  documentRevision: number
  html: string
  manifestHash: string
}

type ThumbnailStatusInput = {
  deckId: string
  documentRevision: number
  manifestHash: string
  enqueueIfMissing?: boolean
  html?: string
  loadHtml?: () => Promise<string | null>
  waitMs?: number
  signal?: AbortSignal
}

export function thumbnailManifestHash(html: string) {
  return hashRuntimeManifest(buildDeckRuntimeManifestFromHtml(html))
}

function slideUrl(deckId: string, revision: number, index: number, hash: string) {
  const query = new URLSearchParams({ hash })
  return `/api/decks/${encodeURIComponent(deckId)}/thumbnails/${revision}/${index}.png?${query}`
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

  const inspect = async (input: ThumbnailEnqueueInput) => {
    const fingerprints = computeThumbnailSlideFingerprints(input.html, input.manifestHash)
    const images = await Promise.all(
      fingerprints.slideFingerprints.map((hash) =>
        options.workspaceStore.readThumbnail(
          input.deckId,
          hash,
          THUMBNAIL_RENDERER_VERSION,
          input.manifestHash,
        ),
      ),
    )
    return { fingerprints, images }
  }

  const readyResult = (
    input: ThumbnailEnqueueInput,
    fingerprints: ReturnType<typeof computeThumbnailSlideFingerprints>,
  ): ThumbnailStatusResult => ({
    status: THUMBNAIL_STATUS.ready,
    slides: fingerprints.slideFingerprints.map((hash, index) => ({
      index,
      url: slideUrl(input.deckId, input.documentRevision, index, hash),
    })),
    width: THUMBNAIL_OUTPUT_WIDTH,
    height: THUMBNAIL_OUTPUT_HEIGHT,
  })

  const render = async (input: ThumbnailEnqueueInput) => {
    const jobKey = key(input)
    const { fingerprints, images } = await inspect(input)
    const slideCount = fingerprints.parsed.slideCount
    if (slideCount < 1) throw new Error('Deck has no slides to render.')
    if (slideCount > THUMBNAIL_MAX_SLIDES) {
      throw new Error(`Deck has ${slideCount} slides; thumbnails allow ${THUMBNAIL_MAX_SLIDES}.`)
    }
    await options.workspaceStore.pruneThumbnails(
      input.deckId,
      fingerprints.slideFingerprints,
      THUMBNAIL_RENDERER_VERSION,
      input.manifestHash,
    )
    const missing = images.flatMap((image, index) => (image ? [] : [index]))
    if (missing.length === 0) return

    const renderedHtml = await resolveArkAssetUrls(options.assetStore, input.deckId, input.html)
    const result = await options.renderer.render({
      html: renderedHtml,
      deckId: input.deckId,
      documentRevision: input.documentRevision,
      slideIndexes: missing,
      slideCount,
    })
    if (!result.ok) throw new Error(result.error)
    if (result.slideCount !== slideCount || result.slides.length !== missing.length) {
      throw new Error('Thumbnail renderer returned an unexpected slide count.')
    }

    const current = await options.deckStore.getDeck(input.deckId)
    if (!current || current.documentRevision !== input.documentRevision) return

    await Promise.all(
      missing.map((slideIndex, resultIndex) =>
        options.workspaceStore.writeThumbnail(input.deckId, {
          slideHash: fingerprints.slideFingerprints[slideIndex]!,
          rendererVersion: THUMBNAIL_RENDERER_VERSION,
          manifestHash: input.manifestHash,
          mediaType: 'image/png',
          width: result.width,
          height: result.height,
          image: result.slides[resultIndex]!,
          cover: slideIndex === 0,
        }),
      ),
    )
    failures.delete(jobKey)
  }

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

  const loadInput = async (input: ThumbnailStatusInput): Promise<ThumbnailEnqueueInput | null> => {
    const html = input.html ?? (await input.loadHtml?.())
    return html
      ? {
          deckId: input.deckId,
          documentRevision: input.documentRevision,
          html,
          manifestHash: input.manifestHash,
        }
      : null
  }

  const waitFor = async (job: Promise<void> | null, input: ThumbnailStatusInput) => {
    const waitMs = Math.min(
      THUMBNAIL_LONG_POLL_MAX_WAIT_MS,
      Math.max(0, Math.floor(input.waitMs ?? 0)),
    )
    if (!job || waitMs === 0) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      job,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, waitMs)
      }),
      new Promise<void>((resolve) => {
        if (input.signal?.aborted) resolve()
        else input.signal?.addEventListener('abort', () => resolve(), { once: true })
      }),
    ])
    if (timeout) clearTimeout(timeout)
  }

  const status = async (input: ThumbnailStatusInput): Promise<ThumbnailStatusResult> => {
    if (!options.renderer.isAvailable()) return { status: THUMBNAIL_STATUS.disabled, slides: [] }
    const loaded = await loadInput(input)
    if (!loaded) return { status: THUMBNAIL_STATUS.failed, slides: [], error: 'Deck not found.' }
    const first = await inspect(loaded)
    if (first.images.length > 0 && first.images.every(Boolean)) {
      return readyResult(loaded, first.fingerprints)
    }
    const job = input.enqueueIfMissing ? schedule(loaded) : null
    await waitFor(job, input)
    const second = await inspect(loaded)
    if (second.images.length > 0 && second.images.every(Boolean)) {
      return readyResult(loaded, second.fingerprints)
    }
    const error = failures.get(key(loaded))
    return error
      ? { status: THUMBNAIL_STATUS.failed, slides: [], error }
      : { status: THUMBNAIL_STATUS.pending, slides: [] }
  }

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
      const fingerprints = computeThumbnailSlideFingerprints(deck.html, input.manifestHash)
      const hash = fingerprints.slideFingerprints[input.slideIndex]
      if (!hash || (input.fingerprint && input.fingerprint !== hash)) return null
      return (
        (
          await options.workspaceStore.readThumbnail(
            input.deckId,
            hash,
            THUMBNAIL_RENDERER_VERSION,
            input.manifestHash,
          )
        )?.image ?? null
      )
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
