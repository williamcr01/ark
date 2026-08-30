/**
 * Builds the service graph the routers close over. Every service is overridable so tests can
 * substitute a fake without standing up SQLite, a thumbnail renderer, or a provider.
 */

import { createAssetStore } from '@ark/storage/stores/asset-store.ts'
import { createChatStore } from '@ark/storage/stores/chat-store.ts'
import { createDeckStore, workspaceStoreFor } from '@ark/storage/stores/deck-store.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'
import { createPreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'
import { createWorkspaceStore } from '@ark/storage/stores/workspace-store.ts'
import type { AssetStore } from '@ark/storage/records/asset-record.ts'
import type { ChatStore } from '@ark/storage/records/chat-record.ts'
import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import type { GenerationJobStore } from '@ark/storage/records/generation-job-record.ts'
import type { PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'
import type { WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

import { createGenerationJobRunner, type GenerationJobRunner } from '@ark/agent/job-runner.ts'
import { getDefaultModel } from '@ark/ai/models.ts'
import { createMcpInteractionStore, type McpInteractionStore } from '@ark/mcp/interactions.ts'
import { createMcpRunner } from '@ark/mcp/runner.ts'
import { createMcpServiceState, type McpServiceState } from '@ark/mcp/service.ts'
import type { ExternalDeckUpdate, McpActivityEvent, McpInteractionChanged } from '@ark/contracts'

import { createRuntimeErrorStore, type RuntimeErrorStore } from './observability/index.ts'
import { createThumbnailRenderSecret } from './thumbnails/render-host.ts'
import { createDisabledThumbnailRenderer, type ThumbnailRenderer } from './thumbnails/renderer.ts'
import { createThumbnailService, type ThumbnailService } from './thumbnails/service.ts'

export type CreateAppOptions = {
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
export type ApiServices = ReturnType<typeof createApiServices>

export function createApiServices(options: CreateAppOptions = {}) {
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
  return {
    assetStore,
    chatStore,
    deckStore,
    defaultModel,
    generationJobs,
    jobStore,
    mcpInteractionStore,
    mcpServiceState,
    notifyDocumentPersisted,
    notifyEditorPatchPersisted,
    previewSessionStore,
    runMcpTool,
    runtimeErrorStore,
    thumbnailRenderSecret,
    thumbnailService,
    workspaceStore,
  }
}
