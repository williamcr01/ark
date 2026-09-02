import { THUMBNAIL_LONG_POLL_MAX_WAIT_MS } from '@ark/contracts'
import type { WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'
import {
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_RENDERER_VERSION,
  THUMBNAIL_STATUS,
  type ThumbnailStatus,
} from './constants.ts'
import { computeThumbnailSlideFingerprints } from './fingerprints.ts'
import type { ThumbnailEnqueueInput } from './service-render.ts'

export type { ThumbnailEnqueueInput }

export type ThumbnailStatusResult = {
  status: ThumbnailStatus
  slides: Array<{ index: number; url: string }>
  error?: string
  width?: number
  height?: number
}

export type ThumbnailStatusInput = {
  deckId: string
  documentRevision: number
  manifestHash: string
  enqueueIfMissing?: boolean
  html?: string
  loadHtml?: () => Promise<string | null>
  waitMs?: number
  signal?: AbortSignal
}

export function thumbnailSlideUrl(deckId: string, revision: number, index: number, hash: string) {
  const query = new URLSearchParams({ hash })
  return `/api/decks/${encodeURIComponent(deckId)}/thumbnails/${revision}/${index}.png?${query}`
}

export function thumbnailReadyResult(
  input: ThumbnailEnqueueInput,
  fingerprints: ReturnType<typeof computeThumbnailSlideFingerprints>,
): ThumbnailStatusResult {
  return {
    status: THUMBNAIL_STATUS.ready,
    slides: fingerprints.slideFingerprints.map((hash, index) => ({
      index,
      url: thumbnailSlideUrl(input.deckId, input.documentRevision, index, hash),
    })),
    width: THUMBNAIL_OUTPUT_WIDTH,
    height: THUMBNAIL_OUTPUT_HEIGHT,
  }
}

export async function loadThumbnailInput(
  input: ThumbnailStatusInput,
): Promise<ThumbnailEnqueueInput | null> {
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

export async function waitForThumbnailJob(job: Promise<void> | null, input: ThumbnailStatusInput) {
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

export async function resolveThumbnailStatus(options: {
  input: ThumbnailStatusInput
  rendererAvailable: boolean
  inspect: (input: ThumbnailEnqueueInput) => Promise<{
    fingerprints: ReturnType<typeof computeThumbnailSlideFingerprints>
    images: Array<unknown>
  }>
  schedule: (input: ThumbnailEnqueueInput) => Promise<void> | null
  failures: Map<string, string>
  jobKey: (input: ThumbnailEnqueueInput) => string
}): Promise<ThumbnailStatusResult> {
  if (!options.rendererAvailable) return { status: THUMBNAIL_STATUS.disabled, slides: [] }
  const loaded = await loadThumbnailInput(options.input)
  if (!loaded) return { status: THUMBNAIL_STATUS.failed, slides: [], error: 'Deck not found.' }
  const first = await options.inspect(loaded)
  if (first.images.length > 0 && first.images.every(Boolean)) {
    return thumbnailReadyResult(loaded, first.fingerprints)
  }
  const job = options.input.enqueueIfMissing ? options.schedule(loaded) : null
  await waitForThumbnailJob(job, options.input)
  const second = await options.inspect(loaded)
  if (second.images.length > 0 && second.images.every(Boolean)) {
    return thumbnailReadyResult(loaded, second.fingerprints)
  }
  const error = options.failures.get(options.jobKey(loaded))
  return error
    ? { status: THUMBNAIL_STATUS.failed, slides: [], error }
    : { status: THUMBNAIL_STATUS.pending, slides: [] }
}

export async function readThumbnailPng(
  workspaceStore: WorkspaceStore,
  input: {
    html: string
    manifestHash: string
    slideIndex: number
    fingerprint?: string
    deckId: string
  },
): Promise<Buffer | null> {
  const fingerprints = computeThumbnailSlideFingerprints(input.html, input.manifestHash)
  const hash = fingerprints.slideFingerprints[input.slideIndex]
  if (!hash || (input.fingerprint && input.fingerprint !== hash)) return null
  return (
    (
      await workspaceStore.readThumbnail(
        input.deckId,
        hash,
        THUMBNAIL_RENDERER_VERSION,
        input.manifestHash,
      )
    )?.image ?? null
  )
}
