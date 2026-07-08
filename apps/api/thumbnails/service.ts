import type { DeckStore } from '../deck-record.ts'
import { createLogger, type Logger } from '../observability/logger.ts'
import {
  buildThumbnailCacheKey,
  buildThumbnailSlideUrl,
  type ThumbnailCache,
  type ThumbnailCacheKey,
  type ThumbnailCacheMeta,
} from './cache.ts'
import {
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_STATUS,
  type ThumbnailStatus,
} from './constants.ts'
import type { ThumbnailRenderer } from './renderer.ts'

export type ThumbnailSlideInfo = {
  index: number
  url: string
}

export type ThumbnailStatusResult = {
  status: ThumbnailStatus
  slides: ThumbnailSlideInfo[]
  error?: string
  width?: number
  height?: number
}

export type ThumbnailEnqueueInput = {
  deckId: string
  versionId: string
  html: string
  manifestHash: string
}

function toStatusResult(
  deckId: string,
  versionId: string,
  manifestHash: string,
  meta: ThumbnailCacheMeta | null,
  fallbackStatus: ThumbnailStatus = THUMBNAIL_STATUS.pending,
): ThumbnailStatusResult {
  if (!meta) {
    return { status: fallbackStatus, slides: [] }
  }

  if (meta.status === THUMBNAIL_STATUS.ready) {
    const slides = Array.from({ length: meta.slideCount }, (_, index) => ({
      index,
      url: buildThumbnailSlideUrl(deckId, versionId, index, manifestHash),
    }))

    return {
      status: THUMBNAIL_STATUS.ready,
      slides,
      width: meta.width,
      height: meta.height,
    }
  }

  return {
    status: meta.status,
    slides: [],
    error: meta.error,
    width: meta.width,
    height: meta.height,
  }
}

export type ThumbnailService = {
  isAvailable: () => boolean
  getStatus: (input: {
    deckId: string
    versionId: string
    manifestHash: string
    enqueueIfMissing?: boolean
    html?: string
  }) => Promise<ThumbnailStatusResult>
  enqueue: (input: ThumbnailEnqueueInput) => Promise<ThumbnailStatusResult>
  readPng: (input: {
    deckId: string
    versionId: string
    manifestHash: string
    slideIndex: number
  }) => Promise<Buffer | null>
  enqueueForDeckVersion: (deckId: string, versionId: string) => Promise<void>
  close: () => Promise<void>
}

export function createThumbnailService(options: {
  cache: ThumbnailCache
  renderer: ThumbnailRenderer
  deckStore: DeckStore
  logger?: Logger
}): ThumbnailService {
  const logger = options.logger ?? createLogger({ service: 'ark-api' })
  const inflight = new Map<string, Promise<void>>()
  let chain: Promise<void> = Promise.resolve()

  const keyId = (key: ThumbnailCacheKey) => `${key.versionId}:${key.manifestHash}`

  const runJob = async (input: ThumbnailEnqueueInput) => {
    const key = buildThumbnailCacheKey(input.versionId, input.manifestHash)
    const baseMeta = {
      deckId: input.deckId,
      versionId: input.versionId,
      manifestHash: key.manifestHash,
      slideCount: 0,
      width: THUMBNAIL_OUTPUT_WIDTH,
      height: THUMBNAIL_OUTPUT_HEIGHT,
    }

    await options.cache.markPending(key, baseMeta)

    const result = await options.renderer.render({
      html: input.html,
      deckId: input.deckId,
      versionId: input.versionId,
    })

    if (!result.ok) {
      await options.cache.markFailed(key, {
        ...baseMeta,
        error: result.error,
      })
      return
    }

    for (let index = 0; index < result.slides.length; index += 1) {
      await options.cache.writeSlidePng(key, index, result.slides[index]!)
    }

    await options.cache.markReady(key, {
      ...baseMeta,
      slideCount: result.slideCount,
      width: result.width,
      height: result.height,
    })

    await options.cache.cleanup()
  }

  const enqueueInternal = (input: ThumbnailEnqueueInput) => {
    if (!options.renderer.isAvailable()) {
      return Promise.resolve(
        toStatusResult(
          input.deckId,
          input.versionId,
          input.manifestHash,
          {
            status: THUMBNAIL_STATUS.disabled,
            deckId: input.deckId,
            versionId: input.versionId,
            manifestHash: input.manifestHash || 'none',
            slideCount: 0,
            width: THUMBNAIL_OUTPUT_WIDTH,
            height: THUMBNAIL_OUTPUT_HEIGHT,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          THUMBNAIL_STATUS.disabled,
        ),
      )
    }

    const key = buildThumbnailCacheKey(input.versionId, input.manifestHash)
    const id = keyId(key)
    const existing = inflight.get(id)

    if (!existing) {
      const job = chain
        .catch(() => undefined)
        .then(async () => {
          const meta = await options.cache.readMeta(key)

          if (meta?.status === THUMBNAIL_STATUS.ready) {
            return
          }

          await runJob(input)
        })
        .catch((error) => {
          logger.warn('thumbnail.queue.failed', {
            deckId: input.deckId,
            fields: {
              versionId: input.versionId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        })
        .finally(() => {
          if (inflight.get(id) === job) {
            inflight.delete(id)
          }
        })

      inflight.set(id, job)
      chain = job
    }

    return options.cache.readMeta(key).then((meta) =>
      toStatusResult(
        input.deckId,
        input.versionId,
        input.manifestHash,
        meta ?? {
          status: THUMBNAIL_STATUS.pending,
          deckId: input.deckId,
          versionId: input.versionId,
          manifestHash: key.manifestHash,
          slideCount: 0,
          width: THUMBNAIL_OUTPUT_WIDTH,
          height: THUMBNAIL_OUTPUT_HEIGHT,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ),
    )
  }

  return {
    isAvailable: () => options.renderer.isAvailable(),
    async getStatus(input) {
      if (!options.renderer.isAvailable()) {
        return { status: THUMBNAIL_STATUS.disabled, slides: [] }
      }

      const key = buildThumbnailCacheKey(input.versionId, input.manifestHash)
      const meta = await options.cache.readMeta(key)

      if (meta?.status === THUMBNAIL_STATUS.ready || meta?.status === THUMBNAIL_STATUS.failed) {
        return toStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (input.enqueueIfMissing && input.html) {
        return enqueueInternal({
          deckId: input.deckId,
          versionId: input.versionId,
          html: input.html,
          manifestHash: input.manifestHash,
        })
      }

      if (meta) {
        return toStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      return { status: THUMBNAIL_STATUS.pending, slides: [] }
    },
    enqueue: enqueueInternal,
    async readPng(input) {
      const key = buildThumbnailCacheKey(input.versionId, input.manifestHash)
      const meta = await options.cache.readMeta(key)

      if (meta?.status !== THUMBNAIL_STATUS.ready) {
        return null
      }

      if (input.slideIndex < 0 || input.slideIndex >= meta.slideCount) {
        return null
      }

      return options.cache.readSlidePng(key, input.slideIndex)
    },
    async enqueueForDeckVersion(deckId, versionId) {
      if (!options.renderer.isAvailable()) {
        return
      }

      const version = await options.deckStore.getVersion(deckId, versionId)

      if (!version) {
        return
      }

      const manifestHash = version.provenance?.runtimeManifestHash ?? 'none'

      await enqueueInternal({
        deckId,
        versionId,
        html: version.html,
        manifestHash,
      })
    },
    async close() {
      await options.renderer.close()
    },
  }
}
