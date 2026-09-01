/** Mounts every router onto the app, in the order the middleware stack requires. */

import express, { type Express } from 'express'

import { createObservabilityMiddleware } from '../observability/index.ts'
import { createThumbnailRenderRouter } from '../thumbnails/render-host.ts'
import type { McpActivityEvent } from '@ark/contracts'

import type { ApiServices } from '../services.ts'

import { createAssetsRouter } from './assets.ts'
import { createDeckChatRouter } from './deck-chat.ts'
import { createDeckThreadsRouter } from './deck-threads.ts'
import { createDecksRouter } from './decks.ts'
import { createGenerationJobsRouter } from './generation-jobs.ts'
import { createMcpRouter } from './mcp.ts'
import { createImportPptxRouter } from './import-pptx.ts'
import { createMiscRouter } from './misc.ts'
import { createPreviewSessionsRouter } from './preview-sessions.ts'
import { createRuntimesAndAssetsRouter } from './runtimes-and-assets.ts'
import { createThumbnailsRouter } from './thumbnails.ts'
import { createWorkspacesRouter } from './workspaces.ts'

export type RouteOptions = {
  onMcpActivity?: (activity: McpActivityEvent) => void
}

export function registerRoutes(app: Express, services: ApiServices, options: RouteOptions = {}) {
  const {
    assetStore,
    chatStore,
    deckStore,
    defaultModel,
    generationJobs,
    mcpServiceState,
    notifyDocumentPersisted,
    notifyEditorPatchPersisted,
    previewSessionStore,
    runMcpTool,
    runtimeErrorStore,
    thumbnailRenderSecret,
    thumbnailService,
    workspaceStore,
  } = services

  app.use(createObservabilityMiddleware())

  // Assets are mounted before the global JSON parser so the upload route can
  // apply its own larger body limit for base64-encoded files.
  app.use(createAssetsRouter({ assetStore, deckStore }))

  // Preview sessions keep their own 12mb deck limit. In-memory session count
  // and byte caps are enforced in the store.
  app.use(createPreviewSessionsRouter({ previewSessionStore, assetStore }))

  app.use(express.json({ limit: '72mb' }))

  app.use(createRuntimesAndAssetsRouter())
  app.use(createMiscRouter({ defaultModel, runtimeErrorStore }))
  app.use(
    createMcpRouter({
      state: mcpServiceState,
      runTool: runMcpTool,
      onActivity: options.onMcpActivity,
    }),
  )
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
      onDocumentPersisted: notifyDocumentPersisted,
      onEditorPatchPersisted: notifyEditorPatchPersisted,
    }),
  )
  app.use(createImportPptxRouter({ deckStore, onDocumentPersisted: notifyDocumentPersisted }))
  app.use(createThumbnailsRouter({ deckStore, thumbnailService }))
  app.use(createDeckChatRouter({ deckStore, chatStore }))
  app.use(createDeckThreadsRouter(chatStore))
  app.use(createWorkspacesRouter(workspaceStore, { onDocumentPersisted: notifyDocumentPersisted }))
  app.use(
    createGenerationJobsRouter({
      generationJobs,
      defaultModel,
    }),
  )
}
