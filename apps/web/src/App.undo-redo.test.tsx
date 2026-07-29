import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/test/render-with-router'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const restoreHtmlSnapshot = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: 'deck-1',
    html: '<html>restored</html>',
    title: 'Deck',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }),
)
const patchDeckOperations = vi.hoisted(() => vi.fn())
const historyState = vi.hoisted(() => {
  const entry = {
    beforeHtml: '<html>before</html>',
    afterHtml: '<html>after</html>',
    slideIndex: 0,
    provenance: {
      source: 'manual' as const,
      operation: 'replace_text' as const,
      operations: ['replace_text' as const],
      slideIndexes: [0, 1],
      elementIds: ['el-a', 'el-b'],
      summary: 'Edited text in preview',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  }

  return {
    entry,
    commitUndo: vi.fn(),
    commitRedo: vi.fn(),
    record: vi.fn(),
    canUndo: true,
    canRedo: true,
  }
})

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => mediaState.isDesktop,
}))

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => [{ current: null }, { width: 1280, height: 800 }],
}))

vi.mock('@/hooks/useDeckPersistence', () => ({
  useDeckPersistence: () => ({
    activeVersionId: 'version-1',
    clearVersionPreview: vi.fn(),
    hasDeck: true,
    html: '<html>after</html>',
    inspectVersion: vi.fn(),
    isDirty: false,
    isLoading: false,
    isLoadingVersions: false,
    isSaving: false,
    isPatching: false,
    deckId: 'deck-1',
    deckTitle: 'Deck',
    decks: [],
    deleteActiveDeck: vi.fn(),
    patchDeckOperations,
    persistHtml: vi.fn(),
    previewVersion: null,
    refreshActiveDeck: vi.fn(),
    refreshVersions: vi.fn(),
    renameActiveDeck: vi.fn(),
    restoreHtmlSnapshot,
    rollbackToVersion: vi.fn(),
    saveError: '',
    selectDeck: vi.fn(),
    startNewDeck: vi.fn(),
    versionNumber: 1,
    versions: [],
  }),
}))

vi.mock('@/hooks/useDeckEditHistory', () => ({
  useDeckEditHistory: () => ({
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    undoEntry: historyState.canUndo ? historyState.entry : null,
    redoEntry: historyState.canRedo ? historyState.entry : null,
    record: historyState.record,
    commitUndo: historyState.commitUndo,
    commitRedo: historyState.commitRedo,
    reset: vi.fn(),
  }),
}))

vi.mock('@/hooks/useChatSession', () => ({
  useChatSession: () => ({
    appendMessage: vi.fn(),
    getMessageDeliveryStatus: vi.fn(),
    messages: [],
    reloadChat: vi.fn(),
    resetChat: vi.fn(),
    retryPersist: vi.fn(),
    setMessages: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAvailableModels', () => ({
  useAvailableModels: () => ({
    apiKeyStatus: 'ready',
    canGenerate: true,
    error: '',
    isLoading: false,
    loadModels: vi.fn(),
    models: [],
    selectedModel: 'test-model',
    setSelectedModel: vi.fn(),
    warnings: [],
  }),
}))

vi.mock('@/hooks/useDeckGenerationFlow', () => ({
  useDeckGenerationFlow: () => ({
    activeSteps: [],
    cancelGeneration: vi.fn(),
    failedJobId: null,
    generateDeck: vi.fn(),
    generationError: '',
    generationStatus: null,
    isGenerating: false,
    retryGeneration: vi.fn(),
  }),
}))

vi.mock('@/hooks/useDeckAssets', () => ({
  useDeckAssets: () => ({
    assets: [],
    uploads: [],
    selectedAssetIds: [],
    error: '',
    uploadFiles: vi.fn(),
    removeAsset: vi.fn(),
    dismissUpload: vi.fn(),
    toggleAssetSelected: vi.fn(),
    clearSelection: vi.fn(),
  }),
}))

vi.mock('@/hooks/useDeckActions', () => ({
  useDeckActions: () => ({
    handleDeleteDeck: vi.fn(),
    handleDownload: vi.fn(),
    handleHtmlUpload: vi.fn(),
    handleNewDeck: vi.fn(),
    handleRenameDeck: vi.fn(),
    handleRollbackVersion: vi.fn(),
    handleUploadClick: vi.fn(),
  }),
}))

vi.mock('@/components/AppTitleBar', () => ({
  AppTitleBar: () => <div data-testid="title-bar" />,
}))

vi.mock('@/components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}))

vi.mock('@/components/DeckAssets', () => ({
  DeckAssets: () => <div data-testid="deck-assets" />,
}))

vi.mock('@/components/DeckPreview', () => ({
  DeckPreview: (props: {
    canUndo?: boolean
    canRedo?: boolean
    onUndo?: () => void | Promise<void>
    onRedo?: () => void | Promise<void>
    onPatchEditorOperations?: (
      operations: unknown[],
      slideIndex: number,
      summary: string,
    ) => Promise<unknown>
  }) => (
    <div data-testid="deck-preview">
      <button disabled={!props.canUndo} onClick={() => void props.onUndo?.()} type="button">
        Undo
      </button>
      <button disabled={!props.canRedo} onClick={() => void props.onRedo?.()} type="button">
        Redo
      </button>
      <button
        onClick={() =>
          void (async () => {
            await props.onPatchEditorOperations?.([], 0, 'Dragged element')
            await props.onPatchEditorOperations?.([], 0, 'Duplicated element')
          })()
        }
        type="button"
      >
        Drag then duplicate
      </button>
    </div>
  ),
}))

const { default: App } = await import('./App')

describe('App undo/redo version provenance', () => {
  beforeEach(() => {
    mediaState.isDesktop = true
    historyState.canUndo = true
    historyState.canRedo = true
    restoreHtmlSnapshot.mockClear()
    historyState.commitUndo.mockClear()
    historyState.commitRedo.mockClear()
    historyState.record.mockClear()
    patchDeckOperations.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sends undo provenance on the restore PUT options', async () => {
    const user = userEvent.setup()
    renderWithRouter(<App />)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(restoreHtmlSnapshot).toHaveBeenCalledWith('<html>before</html>', {
        summary: 'Undo: Edited text in preview',
        provenance: {
          operations: ['undo'],
          slideIndexes: [0, 1],
          elementIds: ['el-a', 'el-b'],
        },
      })
    })
    expect(historyState.commitUndo).toHaveBeenCalledTimes(1)
  })

  it('sends redo provenance on the restore PUT options', async () => {
    const user = userEvent.setup()
    renderWithRouter(<App />)

    await user.click(screen.getByRole('button', { name: 'Redo' }))

    await waitFor(() => {
      expect(restoreHtmlSnapshot).toHaveBeenCalledWith('<html>after</html>', {
        summary: 'Redo: Edited text in preview',
        provenance: {
          operations: ['redo'],
          slideIndexes: [0, 1],
          elementIds: ['el-a', 'el-b'],
        },
      })
    })
    expect(historyState.commitRedo).toHaveBeenCalledTimes(1)
  })

  it('keeps drag and immediate duplicate as separate undo snapshots', async () => {
    patchDeckOperations
      .mockResolvedValueOnce({
        deck: { html: '<html>dragged</html>' },
        patch: { changedSlideIndexes: [0], changedElementIds: ['ark-el-1'] },
      })
      .mockResolvedValueOnce({
        deck: { html: '<html>duplicated</html>' },
        patch: { changedSlideIndexes: [0], changedElementIds: ['ark-el-2'] },
      })
    const user = userEvent.setup()
    renderWithRouter(<App />)

    await user.click(screen.getByRole('button', { name: 'Drag then duplicate' }))
    await waitFor(() => expect(historyState.record).toHaveBeenCalledTimes(2))

    expect(historyState.record.mock.calls[0]?.[0]).toMatchObject({
      beforeHtml: '<html>after</html>',
      afterHtml: '<html>dragged</html>',
    })
    expect(historyState.record.mock.calls[1]?.[0]).toMatchObject({
      beforeHtml: '<html>dragged</html>',
      afterHtml: '<html>duplicated</html>',
    })
  })
})
