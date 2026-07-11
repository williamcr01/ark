import type { DeckStore } from '../deck-record.ts'
import { THUMBNAIL_LONG_POLL_MAX_WAIT_MS } from '@ark/contracts'
import { createLogger, type Logger } from '../observability/logger.ts'
import {
  buildThumbnailCacheKey,
  buildThumbnailSlideUrl,
  type ThumbnailCache,
  type ThumbnailCacheKey,
  type ThumbnailCacheMeta,
} from './cache.ts'
import {
  THUMBNAIL_FAILED_RETRY_DELAY_MS,
  THUMBNAIL_MAX_RENDER_ATTEMPTS,
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_QUEUE_MAX_PENDING,
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

type ThumbnailStatusInput = {
  deckId: string
  versionId: string
  manifestHash: string
  enqueueIfMissing?: boolean
  html?: string
  loadHtml?: () => Promise<string | null>
  waitMs?: number
  signal?: AbortSignal
}

type ThumbnailInternalEnqueueInput = Omit<ThumbnailEnqueueInput, 'html'> & {
  html?: string
  loadHtml?: () => Promise<string | null>
}

function shouldRetryFailedRender(meta: ThumbnailCacheMeta, now = Date.now()) {
  if (meta.status !== THUMBNAIL_STATUS.failed) {
    return false
  }

  if ((meta.attempts ?? 1) >= THUMBNAIL_MAX_RENDER_ATTEMPTS) {
    return false
  }

  const updatedAtMs = Date.parse(meta.updatedAt)

  if (Number.isNaN(updatedAtMs)) {
    return true
  }

  return now - updatedAtMs >= THUMBNAIL_FAILED_RETRY_DELAY_MS
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
  getStatus: (input: ThumbnailStatusInput) => Promise<ThumbnailStatusResult>
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

  const resolveHtml = async (input: ThumbnailInternalEnqueueInput) => {
    if (typeof input.html === 'string') {
      return input.html
    }

    return (await input.loadHtml?.()) ?? null
  }

  const normalizeWaitMs = (waitMs: number | undefined) =>
    Math.max(0, Math.min(waitMs ?? 0, THUMBNAIL_LONG_POLL_MAX_WAIT_MS))

  const waitForLocalInflight = async (
    key: ThumbnailCacheKey,
    input: {
      deckId: string
      versionId: string
      manifestHash: string
      waitMs?: number
      signal?: AbortSignal
    },
  ) => {
    const waitMs = normalizeWaitMs(input.waitMs)
    const job = inflight.get(keyId(key))

    if (!job || waitMs === 0) {
      return null
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let abortListener: (() => void) | null = null

    await Promise.race([
      job,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, waitMs)
      }),
      new Promise<void>((resolve) => {
        if (!input.signal) {
          return
        }

        if (input.signal.aborted) {
          resolve()
          return
        }

        abortListener = () => resolve()
        input.signal.addEventListener('abort', abortListener, { once: true })
      }),
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (input.signal && abortListener) {
        input.signal.removeEventListener('abort', abortListener)
      }
    })

    const meta = await options.cache.readMeta(key)
    return toStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
  }

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

  const enqueueInternal = (input: ThumbnailInternalEnqueueInput) => {
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

    // Bound the serialized queue: unauthenticated status polls can enqueue
    // renders, so a saturated queue skips new jobs instead of growing without
    // limit. Clients keep polling `pending` and re-enqueue once it drains.
    if (!existing && inflight.size >= THUMBNAIL_QUEUE_MAX_PENDING) {
      logger.warn('thumbnail.queue.saturated', {
        deckId: input.deckId,
        fields: {
          versionId: input.versionId,
          queued: inflight.size,
        },
      })
    } else if (!existing) {
      const job = chain
        .catch(() => undefined)
        .then(async () => {
          const meta = await options.cache.readMeta(key)

          if (meta?.status === THUMBNAIL_STATUS.ready) {
            return
          }

          // Permanent failures (attempt budget exhausted) stay terminal so a
          // broken deck cannot burn render time on every warm/poll.
          if (
            meta?.status === THUMBNAIL_STATUS.failed &&
            (meta.attempts ?? 1) >= THUMBNAIL_MAX_RENDER_ATTEMPTS
          ) {
            return
          }

          const html = await resolveHtml(input)

          if (!html) {
            logger.warn('thumbnail.queue.missing_html', {
              deckId: input.deckId,
              fields: {
                versionId: input.versionId,
              },
            })
            return
          }

          await runJob({ ...input, html })
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

      if (meta?.status === THUMBNAIL_STATUS.ready) {
        return toStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (meta?.status === THUMBNAIL_STATUS.failed) {
        // Transient failures (e.g. Chromium cold-start timeouts) get a bounded
        // retry budget; once exhausted the failure is terminal for this key.
        if (
          input.enqueueIfMissing &&
          (input.html || input.loadHtml) &&
          shouldRetryFailedRender(meta)
        ) {
          const result = await enqueueInternal({
            deckId: input.deckId,
            versionId: input.versionId,
            html: input.html,
            loadHtml: input.loadHtml,
            manifestHash: input.manifestHash,
          })
          const waited = await waitForLocalInflight(key, input)

          if (waited && waited.status !== THUMBNAIL_STATUS.failed) {
            return waited
          }

          // The cached meta still says failed until the retry job runs; report
          // pending so clients keep polling through the retry.
          if (result.status === THUMBNAIL_STATUS.failed) {
            return { status: THUMBNAIL_STATUS.pending, slides: [] }
          }

          return result
        }

        return toStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (meta?.status === THUMBNAIL_STATUS.pending) {
        const waited = await waitForLocalInflight(key, input)
        return waited ?? toStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (input.enqueueIfMissing && (input.html || input.loadHtml)) {
        const result = await enqueueInternal({
          deckId: input.deckId,
          versionId: input.versionId,
          html: input.html,
          loadHtml: input.loadHtml,
          manifestHash: input.manifestHash,
        })
        const waited = await waitForLocalInflight(key, input)

        return waited ?? result
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
