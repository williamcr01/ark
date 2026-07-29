import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeckEditHistoryEntry } from '@/hooks/useDeckEditHistory'
import { renderWithRouter } from '@/test/render-with-router'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const persistenceState = vi.hoisted(() => ({
  deckId: 'deck-1' as string | null,
}))
const generationFlowCapture = vi.hoisted(() => ({
  onGenerationSucceeded: null as (() => void) | null | undefined,
}))
const historyCapture = vi.hoisted(() => ({
  current: null as {
    canUndo: boolean
    canRedo: boolean
    undoEntry: unknown
    record: (entry: DeckEditHistoryEntry) => void
    reset: () => void
  } | null,
}))

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
    deckId: persistenceState.deckId,
    deckTitle: 'Deck',
    decks: [],
    deleteActiveDeck: vi.fn(),
    patchDeckOperations: vi.fn(),
    persistHtml: vi.fn(),
    previewVersion: null,
    refreshActiveDeck: vi.fn(),
    refreshVersions: vi.fn(),
    renameActiveDeck: vi.fn(),
    restoreHtmlSnapshot: vi.fn(),
    rollbackToVersion: vi.fn(),
    saveError: '',
    selectDeck: vi.fn(),
    startNewDeck: vi.fn(),
    versionNumber: 1,
    versions: [],
  }),
}))

vi.mock('@/hooks/useDeckEditHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDeckEditHistory')>()

  return {
    useDeckEditHistory: () => {
      const history = actual.useDeckEditHistory()
      historyCapture.current = history
      return history
    },
  }
})

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
  useDeckGenerationFlow: (options: { onGenerationSucceeded?: () => void }) => {
    generationFlowCapture.onGenerationSucceeded = options.onGenerationSucceeded
    return {
      activeSteps: [],
      cancelGeneration: vi.fn(),
      failedJobId: null,
      generateDeck: vi.fn(),
      generationError: '',
      generationStatus: null,
      isGenerating: false,
      retryGeneration: vi.fn(),
    }
  },
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
  DeckPreview: (props: { canUndo?: boolean; canRedo?: boolean }) => (
    <div data-testid="deck-preview">
      <output aria-label="Undo availability">{props.canUndo ? 'enabled' : 'disabled'}</output>
      <output aria-label="Redo availability">{props.canRedo ? 'enabled' : 'disabled'}</output>
    </div>
  ),
}))

const { default: App } = await import('./App')

function makeHistoryEntry(id: string): DeckEditHistoryEntry {
  return {
    beforeHtml: `<before-${id}>`,
    afterHtml: `<after-${id}>`,
    slideIndex: 0,
    provenance: {
      source: 'manual',
      operation: 'replace_text',
      operations: ['replace_text'],
      slideIndexes: [0],
      elementIds: [id],
      summary: `Edited ${id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

describe('App generation / deck-switch edit history boundaries', () => {
  beforeEach(() => {
    mediaState.isDesktop = true
    persistenceState.deckId = 'deck-1'
    generationFlowCapture.onGenerationSucceeded = null
    historyCapture.current = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resets manual undo history when AI generation succeeds', async () => {
    renderWithRouter(<App />)

    await waitFor(() => {
      expect(historyCapture.current).not.toBeNull()
      expect(generationFlowCapture.onGenerationSucceeded).toEqual(expect.any(Function))
    })

    act(() => {
      historyCapture.current!.record(makeHistoryEntry('manual-1'))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('enabled')
    })

    act(() => {
      generationFlowCapture.onGenerationSucceeded?.()
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('disabled')
      expect(screen.getByLabelText('Redo availability')).toHaveTextContent('disabled')
    })
    expect(historyCapture.current?.canUndo).toBe(false)
    expect(historyCapture.current?.undoEntry).toBeNull()
  })

  it('resets manual undo history when the active deck changes', async () => {
    const { rerender } = renderWithRouter(<App />)

    await waitFor(() => {
      expect(historyCapture.current).not.toBeNull()
    })

    act(() => {
      historyCapture.current!.record(makeHistoryEntry('manual-2'))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('enabled')
    })

    persistenceState.deckId = 'deck-2'
    rerender(<App />)

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('disabled')
      expect(screen.getByLabelText('Redo availability')).toHaveTextContent('disabled')
    })
    expect(historyCapture.current?.canUndo).toBe(false)
  })
})
