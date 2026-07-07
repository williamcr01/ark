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

type CreateAppOptions = {
  deckStore?: DeckStore
  chatStore?: ChatStore
  assetStore?: AssetStore
  assetStorage?: AssetStorage
  generationJobStore?: GenerationJobStore
  generationJobRunner?: GenerationJobRunner
  previewSessionStore?: PreviewSessionStore
  runtimeErrorStore?: RuntimeErrorStore
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const deckStore = options.deckStore ?? createDefaultDeckStore()
  const chatStore = options.chatStore ?? createDefaultChatStore()
  const assetStore = options.assetStore ?? createDefaultAssetStore()
  const assetStorage = options.assetStorage ?? createDefaultAssetStorage()
  const jobStore = options.generationJobStore ?? createDefaultGenerationJobStore()
  const generationJobs =
    options.generationJobRunner ??
    createGenerationJobRunner({ deckStore, jobStore, chatStore, assetStore, assetStorage })
  const previewSessionStore = options.previewSessionStore ?? createPreviewSessionStore()
  const runtimeErrorStore = options.runtimeErrorStore ?? createRuntimeErrorStore()
  const defaultModel = getDefaultModel()

  app.use(createObservabilityMiddleware())

  // Assets are mounted before the global JSON parser so the upload route can
  // apply its own larger body limit for base64-encoded files.
  app.use(createAssetsRouter({ assetStore, assetStorage, deckStore }))

  app.use(express.json({ limit: '12mb' }))

  app.use(createRuntimesAndAssetsRouter())
  app.use(createMiscRouter({ defaultModel, runtimeErrorStore }))
  app.use(createPreviewSessionsRouter({ previewSessionStore }))
  app.use(createDecksRouter({ deckStore, assetStore, assetStorage }))
  app.use(createDeckVersionsRouter({ deckStore }))
  app.use(createDeckChatRouter({ deckStore, chatStore }))
  app.use(
    createGenerationJobsRouter({
      generationJobs,
      defaultModel,
    }),
  )

  return app
}
