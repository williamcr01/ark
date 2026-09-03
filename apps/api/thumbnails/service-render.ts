import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import type { WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'
import type { AssetStore } from '@ark/storage/records/asset-record.ts'
import { resolveArkAssetUrls } from '@ark/storage/records/asset-resolve.ts'
import { THUMBNAIL_MAX_SLIDES, THUMBNAIL_RENDERER_VERSION } from './constants.ts'
import { computeThumbnailSlideFingerprints } from './fingerprints.ts'
import type { ThumbnailRenderer } from './renderer.ts'

export type ThumbnailEnqueueInput = {
  deckId: string
  documentRevision: number
  html: string
  manifestHash: string
}

export async function inspectThumbnailCoverage(
  workspaceStore: WorkspaceStore,
  input: ThumbnailEnqueueInput,
) {
  const fingerprints = computeThumbnailSlideFingerprints(input.html, input.manifestHash)
  const images = await Promise.all(
    fingerprints.slideFingerprints.map((hash) =>
      workspaceStore.readThumbnail(
        input.deckId,
        hash,
        THUMBNAIL_RENDERER_VERSION,
        input.manifestHash,
      ),
    ),
  )
  return { fingerprints, images }
}

export async function renderMissingThumbnails(options: {
  renderer: ThumbnailRenderer
  deckStore: DeckStore
  workspaceStore: WorkspaceStore
  assetStore: AssetStore
  input: ThumbnailEnqueueInput
  inspect: (
    input: ThumbnailEnqueueInput,
  ) => Promise<Awaited<ReturnType<typeof inspectThumbnailCoverage>>>
  jobKey: string
  failures: Map<string, string>
}) {
  const { input } = options
  const { fingerprints, images } = await options.inspect(input)
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
  options.failures.delete(options.jobKey)
}
