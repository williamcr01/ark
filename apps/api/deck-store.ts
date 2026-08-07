import {
  type DeckStore,
  type DeckSummary,
  type DeckSaveOptions,
  type DeckUpdateOptions,
  type StoredDeck,
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
} from './deck-record.ts'
import { createWorkspaceStore, type WorkspaceRow, type WorkspaceStore } from './workspace-store.ts'
import { extractEmbeddedAssets } from './embedded-assets.ts'

export { extractDeckTitle, isValidDeckId, normalizeDeckTitle }
export type { DeckStore, DeckSummary, DeckSaveOptions, DeckUpdateOptions, StoredDeck }

function toStoredDeck(workspace: WorkspaceRow): StoredDeck {
  return {
    id: workspace.id,
    html: workspace.html,
    title: workspace.title,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    documentRevision: workspace.documentRevision,
    origin: workspace.origin,
    filePath: workspace.path,
  }
}

const workspaceStores = new WeakMap<DeckStore, WorkspaceStore>()

export function workspaceStoreFor(deckStore: DeckStore) {
  return workspaceStores.get(deckStore) ?? null
}

export function createDeckStore(
  workspaceOrDirectory: WorkspaceStore | string = createWorkspaceStore(),
): DeckStore {
  const workspaces =
    typeof workspaceOrDirectory === 'string'
      ? createWorkspaceStore(workspaceOrDirectory)
      : workspaceOrDirectory

  const deckStore: DeckStore = {
    async createDeck(html, options, id) {
      const extracted = extractEmbeddedAssets(html)
      return toStoredDeck(
        await workspaces.create(
          extracted.html,
          id,
          undefined,
          [...(options?.embeddedAssets ?? []), ...extracted.assets],
          options?.origin,
        ),
      )
    },
    async getDeck(id) {
      const workspace = await workspaces.get(id)
      return workspace ? toStoredDeck(workspace) : null
    },
    async listDecks() {
      return (await workspaces.listRecent()).map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        documentRevision: workspace.documentRevision,
        filePath: workspace.path,
        ...(workspace.cover ? { cover: workspace.cover } : {}),
        ...(workspace.missing ? { missing: true } : {}),
      }))
    },
    async updateDeck(id, html, options) {
      const extracted = extractEmbeddedAssets(html)
      const workspace = await workspaces.updateDocument(
        id,
        extracted.html,
        options.expectedDocumentRevision,
        [...(options.embeddedAssets ?? []), ...extracted.assets],
      )
      return workspace ? toStoredDeck(workspace) : null
    },
    async updateDeckMetadata(id, metadata) {
      const workspace = await workspaces.rename(id, metadata.title ?? '')
      return workspace ? toStoredDeck(workspace) : null
    },
    deleteDeck: (id) => workspaces.delete(id),
  }
  workspaceStores.set(deckStore, workspaces)
  return deckStore
}
