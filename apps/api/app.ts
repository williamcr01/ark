import express from 'express'

import { createDeckStore, workspaceStoreFor } from './deck-store.ts'
import { createChatStore } from './chat-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'
import { createAssetStore } from './asset-store.ts'
import { type AssetStore } from './asset-record.ts'
import { type ChatStore } from './chat-record.ts'
import { type DeckStore } from './deck-record.ts'
import { type GenerationJobStore } from './generation-job-record.ts'
import { createGenerationJobStore } from './generation-job-store.ts'
import { createGenerationJobRunner, type GenerationJobRunner } from './generation-job-runner.ts'
import { getDefaultModel } from '@ark/ai/models.ts'
import { createPreviewSessionStore, type PreviewSessionStore } from './preview-sessions.ts'
import {
  createObservabilityMiddleware,
  createRuntimeErrorStore,
  type RuntimeErrorStore,
} from './observability/index.ts'
import { createAssetsRouter } from './routes/assets.ts'
import { createDecksRouter } from './routes/decks.ts'
import { createDeckChatRouter } from './routes/deck-chat.ts'
import { createDeckThreadsRouter } from './routes/deck-threads.ts'
import { createGenerationJobsRouter } from './routes/generation-jobs.ts'
import { createMiscRouter } from './routes/misc.ts'
import { createPreviewSessionsRouter } from './routes/preview-sessions.ts'
import { createRuntimesAndAssetsRouter } from './routes/runtimes-and-assets.ts'
import { createThumbnailsRouter } from './routes/thumbnails.ts'
import { createMcpRouter } from './routes/mcp.ts'
import { createMcpRunner } from './mcp-runner.ts'
import { createMcpServiceState, type McpServiceState } from './mcp-service.ts'
import { createMcpInteractionStore, type McpInteractionStore } from './mcp-interactions.ts'
import type { ExternalDeckUpdate, McpActivityEvent, McpInteractionChanged } from '@ark/contracts'
import { createWorkspacesRouter } from './routes/workspaces.ts'
import {
  createThumbnailRenderRouter,
  createThumbnailRenderSecret,
} from './thumbnails/render-host.ts'
import { createDisabledThumbnailRenderer, type ThumbnailRenderer } from './thumbnails/renderer.ts'
import { createThumbnailService, type ThumbnailService } from './thumbnails/service.ts'

type CreateAppOptions = {
  deckStore?: DeckStore
  chatStore?: ChatStore
  workspaceStore?: WorkspaceStore
  assetStore?: AssetStore
  generationJobStore?: GenerationJobStore
  generationJobRunner?: GenerationJobRunner
  previewSessionStore?: PreviewSessionStore
  runtimeErrorStore?: RuntimeErrorStore
  thumbnailService?: ThumbnailService
  thumbnailRenderer?: ThumbnailRenderer
  /** Process-local secret for /api/thumbnail-render/*; generated when omitted. */
  thumbnailRenderSecret?: string
  mcpServiceState?: McpServiceState
  mcpInteractionStore?: McpInteractionStore
  onExternalDeckUpdate?: (update: ExternalDeckUpdate) => void
  onMcpActivity?: (activity: McpActivityEvent) => void
  onMcpInteractionChanged?: (change: McpInteractionChanged) => void
}

function scheduleThumbnailWarm(
  thumbnailService: ThumbnailService | null | undefined,
  deckId: string | null | undefined,
  documentRevision: number | null | undefined,
  delayMs = 0,
) {
  const revision = Number(documentRevision)
  if (!thumbnailService || !deckId || !Number.isInteger(revision)) {
    return
  }

  const enqueue = () => {
    void thumbnailService.enqueueForDocument(deckId, revision).catch(() => undefined)
  }

  // Editor pointer-up patches defer warm work so thumbnail rendering does not
  // contend with the live-patch response path (issue #287).
  if (delayMs > 0) {
    setTimeout(enqueue, delayMs)
    return
  }

  enqueue()
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const workspaceStore =
    options.workspaceStore ??
    (options.deckStore ? workspaceStoreFor(options.deckStore) : null) ??
    createWorkspaceStore()
  const deckStore = options.deckStore ?? createDeckStore(workspaceStore)
  const chatStore = options.chatStore ?? createChatStore(workspaceStore)
  const assetStore = options.assetStore ?? createAssetStore(workspaceStore)
  const jobStore = options.generationJobStore ?? createGenerationJobStore()
  const previewSessionStore = options.previewSessionStore ?? createPreviewSessionStore()
  const runtimeErrorStore = options.runtimeErrorStore ?? createRuntimeErrorStore()
  const defaultModel = getDefaultModel()
  const thumbnailRenderSecret = options.thumbnailRenderSecret ?? createThumbnailRenderSecret()
  const thumbnailService =
    options.thumbnailService ??
    createThumbnailService({
      renderer: options.thumbnailRenderer ?? createDisabledThumbnailRenderer(),
      deckStore,
      workspaceStore,
      assetStore,
    })
  const mcpServiceState = options.mcpServiceState ?? createMcpServiceState()
  const mcpInteractionStore =
    options.mcpInteractionStore ?? createMcpInteractionStore(options.onMcpInteractionChanged)
  const notifyDocumentPersisted = (deckId: string, documentRevision: number) =>
    scheduleThumbnailWarm(thumbnailService, deckId, documentRevision)
  const notifyEditorPatchPersisted = (deckId: string, documentRevision: number) =>
    scheduleThumbnailWarm(thumbnailService, deckId, documentRevision, 250)
  const runMcpTool = createMcpRunner({
    deckStore,
    state: mcpServiceState,
    interactionStore: mcpInteractionStore,
    onDocumentPersisted: notifyDocumentPersisted,
    onExternalDeckUpdate: options.onExternalDeckUpdate,
  })

  const generationJobs =
    options.generationJobRunner ??
    createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore,
      assetStore,
      onDocumentPersisted: notifyDocumentPersisted,
    })

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
  app.use(createThumbnailsRouter({ deckStore, thumbnailService }))
  app.use(createDeckChatRouter({ deckStore, chatStore }))
  app.use(createDeckThreadsRouter(chatStore))
  app.use(createWorkspacesRouter(workspaceStore))
  app.use(
    createGenerationJobsRouter({
      generationJobs,
      defaultModel,
    }),
  )

  // Exposed for the Electron main process shutdown hook.
  app.locals.thumbnailService = thumbnailService
  app.locals.thumbnailRenderSecret = thumbnailRenderSecret
  app.locals.workspaceStore = workspaceStore
  app.locals.mcpServiceState = mcpServiceState
  app.locals.mcpInteractionStore = mcpInteractionStore
  return app
}
