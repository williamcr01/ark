import type { DeckStore } from '../deck-record.ts'
import { THUMBNAIL_LONG_POLL_MAX_WAIT_MS } from '@ark/contracts'
import { createLogger, type Logger } from '../observability/logger.ts'
import {
  buildThumbnailCacheKey,
  buildThumbnailManifestFingerprint,
  buildThumbnailSlideUrl,
  type ThumbnailCache,
  type ThumbnailCacheKey,
  type ThumbnailCacheMeta,
} from './cache.ts'
import {
  THUMBNAIL_FAILED_RETRY_DELAY_MS,
  THUMBNAIL_MAX_RENDER_ATTEMPTS,
  THUMBNAIL_MAX_SLIDES,
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_PENDING_LEASE_MS,
  THUMBNAIL_QUEUE_CONCURRENCY,
  THUMBNAIL_QUEUE_MAX_PENDING,
  THUMBNAIL_RENDERER_VERSION,
  THUMBNAIL_STATUS,
  type ThumbnailStatus,
} from './constants.ts'
import { computeThumbnailSlideFingerprints } from './fingerprints.ts'
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
  /** Deck version number; used to discard obsolete background warms safely. */
  versionNumber?: number
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

type ThumbnailQueuePriority = 'foreground' | 'background'

type ThumbnailQueueJob = {
  id: string
  key: ThumbnailCacheKey
  input: ThumbnailInternalEnqueueInput
  priority: ThumbnailQueuePriority
  state: 'queued' | 'running'
  enqueuedAt: number
  promise: Promise<void>
  resolve: () => void
}

type ThumbnailRunOutcome = {
  status: ThumbnailStatus
  renderMs: number
  cacheWriteMs: number
  slideCount: number
  error?: string
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

function isStalePending(meta: ThumbnailCacheMeta, now = Date.now()) {
  if (meta.status !== THUMBNAIL_STATUS.pending) {
    return false
  }

  const updatedAtMs = Date.parse(meta.updatedAt)

  if (Number.isNaN(updatedAtMs)) {
    return true
  }

  return now - updatedAtMs >= THUMBNAIL_PENDING_LEASE_MS
}

function isCurrentReadyMeta(meta: ThumbnailCacheMeta | null | undefined) {
  return (
    meta?.status === THUMBNAIL_STATUS.ready && meta.rendererVersion === THUMBNAIL_RENDERER_VERSION
  )
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
      url: buildThumbnailSlideUrl(
        deckId,
        versionId,
        index,
        manifestHash,
        meta.slideFingerprints?.[index],
      ),
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

/** Client-facing status: retriable failures look like pending so long-poll continues. */
function toClientStatusResult(
  deckId: string,
  versionId: string,
  manifestHash: string,
  meta: ThumbnailCacheMeta | null,
  fallbackStatus: ThumbnailStatus = THUMBNAIL_STATUS.pending,
): ThumbnailStatusResult {
  const result = toStatusResult(deckId, versionId, manifestHash, meta, fallbackStatus)

  if (
    result.status === THUMBNAIL_STATUS.failed &&
    meta &&
    (meta.attempts ?? 1) < THUMBNAIL_MAX_RENDER_ATTEMPTS
  ) {
    return { status: THUMBNAIL_STATUS.pending, slides: [] }
  }

  return result
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
    fingerprint?: string
  }) => Promise<Buffer | null>
  enqueueForDeckVersion: (deckId: string, versionId: string) => Promise<void>
  close: () => Promise<void>
}

export function createThumbnailService(options: {
  cache: ThumbnailCache
  renderer: ThumbnailRenderer
  deckStore: DeckStore
  /** Internal tuning seam; production defaults to serialized rendering. */
  queueConcurrency?: number
  logger?: Logger
}): ThumbnailService {
  const logger = options.logger ?? createLogger({ service: 'ark-api' })
  const configuredConcurrency = Math.floor(options.queueConcurrency ?? THUMBNAIL_QUEUE_CONCURRENCY)
  const queueConcurrency = Number.isFinite(configuredConcurrency)
    ? Math.max(1, configuredConcurrency)
    : THUMBNAIL_QUEUE_CONCURRENCY
  const jobsById = new Map<string, ThumbnailQueueJob>()
  const queuedJobs: ThumbnailQueueJob[] = []
  let activeCount = 0
  let closed = false
  let closing: Promise<void> | null = null
  let idleWaiters: Array<() => void> = []

  const keyId = (key: ThumbnailCacheKey) => `${key.versionId}:${key.manifestHash}`

  const notifyIdle = () => {
    if (activeCount > 0 || queuedJobs.length > 0) {
      return
    }

    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) {
      resolve()
    }
  }

  const waitUntilIdle = () => {
    if (activeCount === 0 && queuedJobs.length === 0) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve)
    })
  }

  const resolveHtml = async (input: ThumbnailInternalEnqueueInput) => {
    if (typeof input.html === 'string') {
      return input.html
    }

    return (await input.loadHtml?.()) ?? null
  }

  const normalizeWaitMs = (waitMs: number | undefined) =>
    Math.max(0, Math.min(waitMs ?? 0, THUMBNAIL_LONG_POLL_MAX_WAIT_MS))

  const measureCacheWrite = async <T>(
    timing: { cacheWriteMs: number },
    operation: () => Promise<T>,
  ) => {
    const startedAt = Date.now()

    try {
      return await operation()
    } finally {
      timing.cacheWriteMs += Date.now() - startedAt
    }
  }

  const selectNextQueuedJob = () => {
    const foregroundIndex = queuedJobs.findIndex((job) => job.priority === 'foreground')
    const index = foregroundIndex >= 0 ? foregroundIndex : 0

    if (index < 0) {
      return null
    }

    return queuedJobs.splice(index, 1)[0] ?? null
  }

  const logSkippedJob = (job: ThumbnailQueueJob, queueWaitMs: number, reason: string) => {
    logger.info('thumbnail.queue.skipped', {
      deckId: job.input.deckId,
      durationMs: queueWaitMs,
      fields: {
        versionId: job.input.versionId,
        manifestHash: job.input.manifestHash,
        priority: job.priority,
        queueWaitMs,
        reason,
      },
    })
  }

  function drainQueue() {
    while (activeCount < queueConcurrency) {
      const job = selectNextQueuedJob()

      if (!job) {
        return
      }

      job.state = 'running'
      activeCount += 1

      void runQueuedJob(job).finally(() => {
        activeCount -= 1

        if (jobsById.get(job.id) === job) {
          jobsById.delete(job.id)
        }

        job.resolve()
        drainQueue()
        notifyIdle()
      })
    }
  }

  const discardQueuedJob = (
    job: ThumbnailQueueJob,
    reason: string,
    replacement: ThumbnailInternalEnqueueInput,
  ) => {
    const index = queuedJobs.indexOf(job)

    if (index < 0) {
      return
    }

    queuedJobs.splice(index, 1)

    if (jobsById.get(job.id) === job) {
      jobsById.delete(job.id)
    }

    job.resolve()
    logger.info('thumbnail.queue.discarded', {
      deckId: job.input.deckId,
      fields: {
        versionId: job.input.versionId,
        manifestHash: job.input.manifestHash,
        priority: job.priority,
        replacementVersionId: replacement.versionId,
        replacementManifestHash: replacement.manifestHash,
        reason,
      },
    })
  }

  const discardObsoleteWarmJobs = (input: ThumbnailInternalEnqueueInput, replacementId: string) => {
    const incomingVersion = input.versionNumber

    for (let index = queuedJobs.length - 1; index >= 0; index -= 1) {
      const job = queuedJobs[index]

      if (
        !job ||
        job.id === replacementId ||
        job.priority !== 'background' ||
        job.input.deckId !== input.deckId
      ) {
        continue
      }

      // Only discard strictly older warms. An out-of-order older warm must not
      // discard a newer (or equal) warm that already landed in the queue.
      const jobVersion = job.input.versionNumber

      if (
        typeof incomingVersion === 'number' &&
        typeof jobVersion === 'number' &&
        jobVersion < incomingVersion
      ) {
        discardQueuedJob(job, 'obsolete_warm', input)
      }
    }
  }

  const isObsoleteIncomingWarm = (input: ThumbnailInternalEnqueueInput) => {
    const incomingVersion = input.versionNumber

    if (typeof incomingVersion !== 'number') {
      return false
    }

    for (const job of jobsById.values()) {
      if (job.priority !== 'background' || job.input.deckId !== input.deckId) {
        continue
      }

      const jobVersion = job.input.versionNumber

      if (typeof jobVersion === 'number' && jobVersion >= incomingVersion) {
        return true
      }
    }

    return false
  }

  const evictQueuedBackgroundJob = (replacement: ThumbnailInternalEnqueueInput) => {
    for (let index = queuedJobs.length - 1; index >= 0; index -= 1) {
      const job = queuedJobs[index]

      if (job?.priority === 'background' && job.state === 'queued') {
        discardQueuedJob(job, 'foreground_priority', replacement)
        return true
      }
    }

    return false
  }

  const mergeJobInput = (
    existing: ThumbnailQueueJob,
    input: ThumbnailInternalEnqueueInput,
    priority: ThumbnailQueuePriority,
  ) => {
    if (
      existing.state === 'queued' &&
      existing.priority === 'background' &&
      priority === 'foreground'
    ) {
      existing.priority = 'foreground'
      logger.debug('thumbnail.queue.promoted', {
        deckId: existing.input.deckId,
        fields: {
          versionId: existing.input.versionId,
          manifestHash: existing.input.manifestHash,
          priority: existing.priority,
        },
      })
    }

    if (typeof existing.input.html !== 'string' && typeof input.html === 'string') {
      existing.input = { ...existing.input, html: input.html }
    }

    if (!existing.input.loadHtml && input.loadHtml) {
      existing.input = { ...existing.input, loadHtml: input.loadHtml }
    }
  }

  const enqueueScheduledJob = (
    input: ThumbnailInternalEnqueueInput,
    priority: ThumbnailQueuePriority,
  ) => {
    if (closed) {
      return null
    }

    const key = buildThumbnailCacheKey(input.versionId, input.manifestHash)
    const id = keyId(key)
    const existing = jobsById.get(id)

    if (existing) {
      mergeJobInput(existing, input, priority)
      return existing
    }

    if (priority === 'background') {
      discardObsoleteWarmJobs(input, id)

      // A late older warm must not join the queue when a newer warm is already
      // present (queued or running) for the same deck.
      if (isObsoleteIncomingWarm(input)) {
        logger.info('thumbnail.queue.discarded', {
          deckId: input.deckId,
          fields: {
            versionId: input.versionId,
            manifestHash: input.manifestHash,
            priority,
            versionNumber: input.versionNumber,
            reason: 'obsolete_warm',
          },
        })
        return null
      }
    }

    // Bound the queue: unauthenticated status polls can enqueue renders, so a
    // saturated queue skips new jobs instead of growing without limit. Clients
    // keep polling `pending` and re-enqueue once it drains. Foreground polls
    // may evict one queued background warm to stay responsive.
    if (jobsById.size >= THUMBNAIL_QUEUE_MAX_PENDING) {
      if (priority === 'foreground' && evictQueuedBackgroundJob(input)) {
        // Room freed for the foreground job below.
      } else {
        logger.warn('thumbnail.queue.saturated', {
          deckId: input.deckId,
          fields: {
            versionId: input.versionId,
            queued: jobsById.size,
            priority,
          },
        })
        return null
      }
    }

    let resolveJob!: () => void
    const promise = new Promise<void>((resolve) => {
      resolveJob = resolve
    })
    const job: ThumbnailQueueJob = {
      id,
      key,
      input,
      priority,
      state: 'queued',
      enqueuedAt: Date.now(),
      promise,
      resolve: resolveJob,
    }

    jobsById.set(id, job)
    queuedJobs.push(job)
    drainQueue()
    return job
  }

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
    const job = jobsById.get(keyId(key))?.promise

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
    return toClientStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
  }

  const runJob = async (input: ThumbnailEnqueueInput): Promise<ThumbnailRunOutcome> => {
    const key = buildThumbnailCacheKey(input.versionId, input.manifestHash)
    const timing = { cacheWriteMs: 0 }
    const fingerprints = computeThumbnailSlideFingerprints(input.html, key.manifestHash)
    const baseMeta = {
      deckId: input.deckId,
      versionId: input.versionId,
      manifestHash: key.manifestHash,
      slideCount: fingerprints.parsed.slideCount,
      slideFingerprints: fingerprints.slideFingerprints,
      rendererVersion: THUMBNAIL_RENDERER_VERSION,
      width: THUMBNAIL_OUTPUT_WIDTH,
      height: THUMBNAIL_OUTPUT_HEIGHT,
    }

    await measureCacheWrite(timing, () => options.cache.markPending(key, baseMeta))

    if (fingerprints.parsed.slideCount <= 0) {
      const error = 'Deck has no slides to render.'
      await measureCacheWrite(timing, () =>
        options.cache.markFailed(key, {
          ...baseMeta,
          error,
        }),
      )
      return {
        status: THUMBNAIL_STATUS.failed,
        renderMs: 0,
        cacheWriteMs: timing.cacheWriteMs,
        slideCount: 0,
        error,
      }
    }

    if (fingerprints.parsed.slideCount > THUMBNAIL_MAX_SLIDES) {
      const error = `Deck has ${fingerprints.parsed.slideCount} slides; thumbnail renderer allows at most ${THUMBNAIL_MAX_SLIDES}.`
      await measureCacheWrite(timing, () =>
        options.cache.markFailed(key, {
          ...baseMeta,
          error,
        }),
      )
      return {
        status: THUMBNAIL_STATUS.failed,
        renderMs: 0,
        cacheWriteMs: timing.cacheWriteMs,
        slideCount: fingerprints.parsed.slideCount,
        error,
      }
    }

    const missingSlideIndexes: number[] = []

    await measureCacheWrite(timing, async () => {
      for (let index = 0; index < fingerprints.slideFingerprints.length; index += 1) {
        const fingerprint = fingerprints.slideFingerprints[index]!
        const materialized = await options.cache.materializeSlidePngFromBlob(
          key,
          index,
          fingerprint,
        )

        if (!materialized) {
          missingSlideIndexes.push(index)
        }
      }
    })

    let renderMs = 0

    if (missingSlideIndexes.length > 0) {
      const renderStartedAt = Date.now()
      const result = await options.renderer.render({
        html: input.html,
        deckId: input.deckId,
        versionId: input.versionId,
        slideIndexes: missingSlideIndexes,
      })
      renderMs = result.durationMs ?? Date.now() - renderStartedAt

      if (!result.ok) {
        await measureCacheWrite(timing, () =>
          options.cache.markFailed(key, {
            ...baseMeta,
            error: result.error,
          }),
        )
        return {
          status: THUMBNAIL_STATUS.failed,
          renderMs,
          cacheWriteMs: timing.cacheWriteMs,
          slideCount: fingerprints.parsed.slideCount,
          error: result.error,
        }
      }

      if (
        result.slideCount !== fingerprints.parsed.slideCount ||
        result.slides.length !== missingSlideIndexes.length
      ) {
        const error = 'Thumbnail renderer returned an unexpected slide count.'
        await measureCacheWrite(timing, () =>
          options.cache.markFailed(key, {
            ...baseMeta,
            error,
          }),
        )
        return {
          status: THUMBNAIL_STATUS.failed,
          renderMs,
          cacheWriteMs: timing.cacheWriteMs,
          slideCount: fingerprints.parsed.slideCount,
          error,
        }
      }

      await measureCacheWrite(timing, async () => {
        for (let offset = 0; offset < missingSlideIndexes.length; offset += 1) {
          const slideIndex = missingSlideIndexes[offset]!
          await options.cache.writeSlidePng(
            key,
            slideIndex,
            result.slides[offset]!,
            fingerprints.slideFingerprints[slideIndex],
          )
        }
      })
    }

    await measureCacheWrite(timing, async () => {
      await options.cache.markReady(key, {
        ...baseMeta,
      })
      await options.cache.cleanup()
    })

    return {
      status: THUMBNAIL_STATUS.ready,
      renderMs,
      cacheWriteMs: timing.cacheWriteMs,
      slideCount: fingerprints.parsed.slideCount,
    }
  }

  async function runQueuedJob(job: ThumbnailQueueJob) {
    const queueWaitMs = Date.now() - job.enqueuedAt

    try {
      const meta = await options.cache.readMeta(job.key)

      if (isCurrentReadyMeta(meta)) {
        logSkippedJob(job, queueWaitMs, 'ready')
        return
      }

      // Permanent failures (attempt budget exhausted) stay terminal so a
      // broken deck cannot burn render time on every warm/poll.
      if (
        meta?.status === THUMBNAIL_STATUS.failed &&
        (meta.attempts ?? 1) >= THUMBNAIL_MAX_RENDER_ATTEMPTS
      ) {
        logSkippedJob(job, queueWaitMs, 'failed_attempt_budget_exhausted')
        return
      }

      const html = await resolveHtml(job.input)

      if (!html) {
        logger.warn('thumbnail.queue.missing_html', {
          deckId: job.input.deckId,
          fields: {
            versionId: job.input.versionId,
          },
        })
        return
      }

      const outcome = await runJob({ ...job.input, html })
      const durationMs = Date.now() - job.enqueuedAt

      logger.info('thumbnail.queue.completed', {
        deckId: job.input.deckId,
        durationMs,
        fields: {
          versionId: job.input.versionId,
          manifestHash: job.input.manifestHash,
          priority: job.priority,
          queueWaitMs,
          renderMs: outcome.renderMs,
          cacheWriteMs: outcome.cacheWriteMs,
          status: outcome.status,
          slideCount: outcome.slideCount,
          error: outcome.error,
        },
      })
    } catch (error) {
      logger.warn('thumbnail.queue.failed', {
        deckId: job.input.deckId,
        fields: {
          versionId: job.input.versionId,
          priority: job.priority,
          queueWaitMs,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const enqueueInternal = (
    input: ThumbnailInternalEnqueueInput,
    priority: ThumbnailQueuePriority = 'foreground',
  ) => {
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
    enqueueScheduledJob(input, priority)

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

      if (isCurrentReadyMeta(meta)) {
        return toClientStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (meta?.status === THUMBNAIL_STATUS.failed) {
        // Transient failures (e.g. Chromium cold-start timeouts) get a bounded
        // retry budget; once exhausted the failure is terminal for this key.
        if (
          input.enqueueIfMissing &&
          (input.html || input.loadHtml) &&
          shouldRetryFailedRender(meta)
        ) {
          await enqueueInternal({
            deckId: input.deckId,
            versionId: input.versionId,
            html: input.html,
            loadHtml: input.loadHtml,
            manifestHash: input.manifestHash,
          })
          const waited = await waitForLocalInflight(key, input)

          if (waited) {
            return waited
          }

          // Cached meta may still say failed until markPending runs; map
          // retriable failed → pending so clients keep long-polling.
          return toClientStatusResult(
            input.deckId,
            input.versionId,
            input.manifestHash,
            await options.cache.readMeta(key),
          )
        }

        return toClientStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (meta?.status === THUMBNAIL_STATUS.pending) {
        const waited = await waitForLocalInflight(key, input)

        if (waited) {
          return waited
        }

        // No local inflight: another process may own fresh pending work. Only
        // steal after the lease expires (e.g. API restart left orphaned pending).
        if (isStalePending(meta) && input.enqueueIfMissing && (input.html || input.loadHtml)) {
          await enqueueInternal({
            deckId: input.deckId,
            versionId: input.versionId,
            html: input.html,
            loadHtml: input.loadHtml,
            manifestHash: input.manifestHash,
          })
          const waitedAfterEnqueue = await waitForLocalInflight(key, input)

          if (waitedAfterEnqueue) {
            return waitedAfterEnqueue
          }

          return toClientStatusResult(
            input.deckId,
            input.versionId,
            input.manifestHash,
            await options.cache.readMeta(key),
          )
        }

        return toClientStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
      }

      if (input.enqueueIfMissing && (input.html || input.loadHtml)) {
        await enqueueInternal({
          deckId: input.deckId,
          versionId: input.versionId,
          html: input.html,
          loadHtml: input.loadHtml,
          manifestHash: input.manifestHash,
        })
        const waited = await waitForLocalInflight(key, input)

        return (
          waited ??
          toClientStatusResult(
            input.deckId,
            input.versionId,
            input.manifestHash,
            await options.cache.readMeta(key),
          )
        )
      }

      if (meta) {
        return toClientStatusResult(input.deckId, input.versionId, input.manifestHash, meta)
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

      const expectedFingerprint = meta.slideFingerprints?.[input.slideIndex]

      if (input.fingerprint) {
        const expectedHash =
          expectedFingerprint ?? buildThumbnailManifestFingerprint(key.manifestHash)

        if (input.fingerprint !== expectedHash) {
          return null
        }
      }

      if (expectedFingerprint) {
        return (
          (await options.cache.readBlobPng(expectedFingerprint)) ??
          options.cache.readSlidePng(key, input.slideIndex)
        )
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

      await enqueueInternal(
        {
          deckId,
          versionId,
          html: version.html,
          manifestHash,
          versionNumber: version.versionNumber,
        },
        'background',
      )
    },
    async close() {
      if (closing) {
        return closing
      }

      closing = (async () => {
        closed = true

        for (const job of queuedJobs.splice(0)) {
          if (jobsById.get(job.id) === job) {
            jobsById.delete(job.id)
          }

          job.resolve()
        }

        notifyIdle()
        await waitUntilIdle()
        await options.renderer.close()
      })()

      return closing
    },
  }
}
