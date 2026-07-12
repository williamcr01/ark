import express from 'express'

import { createDefaultDeckStore } from './deck-store.ts'
import { createDefaultChatStore } from './chat-store.ts'
import { createDefaultAssetStore } from './asset-store.ts'
import { createDefaultAssetStorage, type AssetStorage } from './asset-storage.ts'
import { type AssetStore } from './asset-record.ts'
import { type ChatStore } from './chat-record.ts'
import { type DeckStore } from './deck-record.ts'
import { type GenerationJobStore } from './generation-job-record.ts'
import { createDefaultGenerationJobStore } from './generation-job-store.ts'
import { createGenerationJobRunner, type GenerationJobRunner } from './generation-job-runner.ts'
import { getDefaultModel } from './models.ts'
import { createPreviewSessionStore, type PreviewSessionStore } from './preview-sessions.ts'
import {
  createObservabilityMiddleware,
  createRuntimeErrorStore,
  type RuntimeErrorStore,
} from './observability/index.ts'
import { createAssetsRouter } from './routes/assets.ts'
import { createDecksRouter } from './routes/decks.ts'
import { createDeckVersionsRouter } from './routes/deck-versions.ts'
import { createDeckChatRouter } from './routes/deck-chat.ts'
import { createGenerationJobsRouter } from './routes/generation-jobs.ts'
import { createMiscRouter } from './routes/misc.ts'
import { createPreviewSessionsRouter } from './routes/preview-sessions.ts'
import { createRuntimesAndAssetsRouter } from './routes/runtimes-and-assets.ts'
import { createThumbnailsRouter } from './routes/thumbnails.ts'
import { createDefaultThumbnailCache } from './thumbnails/cache.ts'
import { THUMBNAIL_QUEUE_CONCURRENCY, THUMBNAIL_SETTLE_MS } from './thumbnails/constants.ts'
import {
  createThumbnailRenderRouter,
  createThumbnailRenderSecret,
} from './thumbnails/render-host.ts'
import { createThumbnailRenderer } from './thumbnails/renderer.ts'
import { createThumbnailService, type ThumbnailService } from './thumbnails/service.ts'

type CreateAppOptions = {
  deckStore?: DeckStore
  chatStore?: ChatStore
  assetStore?: AssetStore
  assetStorage?: AssetStorage
  generationJobStore?: GenerationJobStore
  generationJobRunner?: GenerationJobRunner
  previewSessionStore?: PreviewSessionStore
  runtimeErrorStore?: RuntimeErrorStore
  thumbnailService?: ThumbnailService
  /** Process-local secret for /api/thumbnail-render/*; generated when omitted. */
  thumbnailRenderSecret?: string
}

function readPositiveIntEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function readNonNegativeIntEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function scheduleThumbnailWarm(
  thumbnailService: ThumbnailService | null | undefined,
  deckId: string | null | undefined,
  versionId: string | null | undefined,
) {
  if (!thumbnailService || !deckId || !versionId) {
    return
  }

  void thumbnailService.enqueueForDeckVersion(deckId, versionId).catch(() => undefined)
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const deckStore = options.deckStore ?? createDefaultDeckStore()
  const chatStore = options.chatStore ?? createDefaultChatStore()
  const assetStore = options.assetStore ?? createDefaultAssetStore()
  const assetStorage = options.assetStorage ?? createDefaultAssetStorage()
  const jobStore = options.generationJobStore ?? createDefaultGenerationJobStore()
  const previewSessionStore = options.previewSessionStore ?? createPreviewSessionStore()
  const runtimeErrorStore = options.runtimeErrorStore ?? createRuntimeErrorStore()
  const defaultModel = getDefaultModel()
  const thumbnailRenderSecret = options.thumbnailRenderSecret ?? createThumbnailRenderSecret()
  const thumbnailQueueConcurrency = readPositiveIntEnv(
    'ARK_THUMBNAIL_QUEUE_CONCURRENCY',
    THUMBNAIL_QUEUE_CONCURRENCY,
  )
  const thumbnailSettleMs = readNonNegativeIntEnv('ARK_THUMBNAIL_SETTLE_MS', THUMBNAIL_SETTLE_MS)

  const thumbnailService =
    options.thumbnailService ??
    createThumbnailService({
      cache: createDefaultThumbnailCache(),
      renderer: createThumbnailRenderer({
        previewSessionStore,
        renderSecret: thumbnailRenderSecret,
        limits: { settleMs: thumbnailSettleMs },
      }),
      deckStore,
      queueConcurrency: thumbnailQueueConcurrency,
    })

  const generationJobs =
    options.generationJobRunner ??
    createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore,
      assetStore,
      assetStorage,
      onDeckVersionPersisted: (deckId, versionId) => {
        scheduleThumbnailWarm(thumbnailService, deckId, versionId)
      },
    })

  app.use(createObservabilityMiddleware())

  // Assets are mounted before the global JSON parser so the upload route can
  // apply its own larger body limit for base64-encoded files.
  app.use(createAssetsRouter({ assetStore, assetStorage, deckStore }))

  app.use(express.json({ limit: '12mb' }))

  app.use(createRuntimesAndAssetsRouter())
  app.use(createMiscRouter({ defaultModel, runtimeErrorStore }))
  app.use(createPreviewSessionsRouter({ previewSessionStore }))
  app.use(
    createThumbnailRenderRouter({
      previewSessionStore,
      renderSecret: thumbnailRenderSecret,
    }),
  )
  app.use(
    createDecksRouter({
      deckStore,
      assetStore,
      assetStorage,
      onDeckVersionPersisted: (deckId, versionId) => {
        scheduleThumbnailWarm(thumbnailService, deckId, versionId)
      },
    }),
  )
  app.use(
    createDeckVersionsRouter({
      deckStore,
      onDeckVersionPersisted: (deckId, versionId) => {
        scheduleThumbnailWarm(thumbnailService, deckId, versionId)
      },
    }),
  )
  app.use(createThumbnailsRouter({ deckStore, thumbnailService }))
  app.use(createDeckChatRouter({ deckStore, chatStore }))
  app.use(
    createGenerationJobsRouter({
      generationJobs,
      defaultModel,
    }),
  )

  // Exposed for the server entrypoint's shutdown hook (closing the Chromium pool)
  // and for live renderer tests that need to authenticate against the render host.
  app.locals.thumbnailService = thumbnailService
  app.locals.thumbnailRenderSecret = thumbnailRenderSecret

  return app
}
