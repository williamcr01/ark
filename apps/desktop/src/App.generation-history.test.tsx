import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeckEditHistoryEntry } from '@/hooks/useDeckEditHistory'
import { renderWithRouter } from '@/test/render-with-router'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const persistenceState = vi.hoisted(() => ({
  deckId: 'deck-1' as string | null,
  documentRevision: 1,
  html: '<html>after</html>',
  isSaving: false,
  isPatching: false,
  refreshActiveDeck: vi.fn(),
}))
const previewState = vi.hoisted(() => ({
  activeSlideIndex: 0,
}))
let externalUpdateListener:
  | ((update: {
      deckId: string
      previousDocumentRevision: number
      documentRevision: number
      clientName: string | null
      toolName: string
      summary: string
    }) => void)
  | null = null
const generationFlowCapture = vi.hoisted(() => ({
  onGenerationSucceeded: null as
    | ((change: { beforeHtml: string; afterHtml: string; deckChanged: boolean }) => void)
    | null
    | undefined,
}))
const historyCapture = vi.hoisted(() => ({
  current: null as {
    canUndo: boolean
    canRedo: boolean
    undoEntry: unknown
    record: (entry: DeckEditHistoryEntry) => void
    commitUndo: () => void
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
    hasDeck: true,
    html: persistenceState.html,
    isDirty: false,
    isLoading: false,
    isSaving: persistenceState.isSaving,
    isPatching: persistenceState.isPatching,
    deckId: persistenceState.deckId,
    documentRevision: persistenceState.documentRevision,
    deckTitle: 'Deck',
    decks: [],
    deleteActiveDeck: vi.fn(),
    patchDeckOperations: vi.fn(),
    persistHtml: vi.fn(),
    refreshActiveDeck: persistenceState.refreshActiveDeck,
    renameActiveDeck: vi.fn(),
    restoreHtmlSnapshot: vi.fn(),
    saveError: '',
    selectDeck: vi.fn(),
    startNewDeck: vi.fn(),
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
  useDeckGenerationFlow: (options: {
    onGenerationSucceeded?: (change: {
      beforeHtml: string
      afterHtml: string
      deckChanged: boolean
    }) => void
  }) => {
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

vi.mock('@/components/DeckPreview', () => ({
  DeckPreview: (props: {
    state: { canUndo: boolean; canRedo: boolean }
    presentHandleRef?: {
      current: { openPresent: () => void; getActiveSlideIndex: () => number } | null
    }
  }) => {
    if (props.presentHandleRef) {
      props.presentHandleRef.current = {
        openPresent: () => undefined,
        getActiveSlideIndex: () => previewState.activeSlideIndex,
      }
    }
    return (
      <div data-testid="deck-preview">
        <output aria-label="Undo availability">
          {props.state.canUndo ? 'enabled' : 'disabled'}
        </output>
        <output aria-label="Redo availability">
          {props.state.canRedo ? 'enabled' : 'disabled'}
        </output>
      </div>
    )
  },
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
    persistenceState.documentRevision = 1
    persistenceState.html = '<html>after</html>'
    persistenceState.isSaving = false
    persistenceState.isPatching = false
    persistenceState.refreshActiveDeck.mockReset()
    previewState.activeSlideIndex = 0
    externalUpdateListener = null
    window.arkDesktop.mcp.onDeckUpdated = vi.fn((listener) => {
      externalUpdateListener = listener
      return () => {
        externalUpdateListener = null
      }
    })
    generationFlowCapture.onGenerationSucceeded = null
    historyCapture.current = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('records one undo boundary when AI generation changes the deck', async () => {
    persistenceState.refreshActiveDeck.mockResolvedValue({
      id: 'deck-1',
      html: '<html>generated</html>',
      title: 'Deck',
      documentRevision: 2,
    })
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
      generationFlowCapture.onGenerationSucceeded?.({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>generated</html>',
        deckChanged: true,
      })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('enabled')
      expect(screen.getByLabelText('Redo availability')).toHaveTextContent('disabled')
    })
    expect(historyCapture.current?.canUndo).toBe(true)
    expect(historyCapture.current?.undoEntry).toMatchObject({
      beforeHtml: '<html>after</html>',
      afterHtml: '<html>generated</html>',
      slideIndex: 0,
      provenance: { source: 'agent' },
    })

    act(() => {
      historyCapture.current!.commitUndo()
    })
    expect(historyCapture.current?.undoEntry).toMatchObject({
      provenance: { source: 'manual', elementIds: ['manual-1'] },
    })
  })

  it('does not reset manual undo history when generation does not change the deck', async () => {
    renderWithRouter(<App />)

    await waitFor(() => {
      expect(historyCapture.current).not.toBeNull()
      expect(generationFlowCapture.onGenerationSucceeded).toEqual(expect.any(Function))
    })

    act(() => {
      historyCapture.current!.record(makeHistoryEntry('manual-keep'))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('enabled')
    })

    act(() => {
      generationFlowCapture.onGenerationSucceeded?.({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>after</html>',
        deckChanged: false,
      })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('enabled')
    })
    expect(historyCapture.current?.canUndo).toBe(true)
    expect(historyCapture.current?.undoEntry).toMatchObject({
      provenance: { source: 'manual', elementIds: ['manual-keep'] },
    })
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

  it('records one undo boundary for a newer external update and ignores duplicates', async () => {
    persistenceState.refreshActiveDeck.mockResolvedValue({
      id: 'deck-1',
      html: '<html>external</html>',
      title: 'Deck',
      documentRevision: 2,
    })
    renderWithRouter(<App />)
    await waitFor(() => expect(externalUpdateListener).toEqual(expect.any(Function)))

    const update = {
      deckId: 'deck-1',
      previousDocumentRevision: 1,
      documentRevision: 2,
      clientName: 'Codex',
      toolName: 'edit_deck',
      summary: 'Updated the opening.',
    }
    act(() => externalUpdateListener?.(update))

    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>external</html>',
        provenance: { source: 'external', clientName: 'Codex', toolName: 'edit_deck' },
      })
    })

    act(() => externalUpdateListener?.(update))
    await waitFor(() => expect(persistenceState.refreshActiveDeck).toHaveBeenCalledTimes(1))
  })

  it('coalesces consecutive MCP writes into one undo boundary', async () => {
    persistenceState.refreshActiveDeck
      .mockResolvedValueOnce({
        id: 'deck-1',
        html: '<html>patch-1</html>',
        title: 'Deck',
        documentRevision: 2,
      })
      .mockResolvedValueOnce({
        id: 'deck-1',
        html: '<html>patch-2</html>',
        title: 'Deck',
        documentRevision: 3,
      })
    renderWithRouter(<App />)
    await waitFor(() => expect(externalUpdateListener).toEqual(expect.any(Function)))

    act(() =>
      externalUpdateListener?.({
        deckId: 'deck-1',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Codex',
        toolName: 'patch_element',
        summary: 'Patched one element.',
      }),
    )
    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>patch-1</html>',
        provenance: { source: 'external', toolName: 'patch_element' },
      })
    })

    act(() =>
      externalUpdateListener?.({
        deckId: 'deck-1',
        previousDocumentRevision: 2,
        documentRevision: 3,
        clientName: 'Codex',
        toolName: 'patch_element',
        summary: 'Patched another element.',
      }),
    )
    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>patch-2</html>',
        provenance: { source: 'external', toolName: 'patch_element' },
      })
    })

    act(() => {
      historyCapture.current!.commitUndo()
    })
    expect(historyCapture.current?.canUndo).toBe(false)
  })

  it('keeps an agent turn and a later MCP write as separate undo steps', async () => {
    persistenceState.refreshActiveDeck.mockResolvedValue({
      id: 'deck-1',
      html: '<html>mcp</html>',
      title: 'Deck',
      documentRevision: 2,
    })
    renderWithRouter(<App />)
    await waitFor(() => {
      expect(generationFlowCapture.onGenerationSucceeded).toEqual(expect.any(Function))
      expect(externalUpdateListener).toEqual(expect.any(Function))
    })

    act(() => {
      generationFlowCapture.onGenerationSucceeded?.({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>agent</html>',
        deckChanged: true,
      })
    })
    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        provenance: { source: 'agent' },
      })
    })

    act(() =>
      externalUpdateListener?.({
        deckId: 'deck-1',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Codex',
        toolName: 'edit_deck',
        summary: 'Updated after the agent.',
      }),
    )
    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        provenance: { source: 'external', toolName: 'edit_deck' },
      })
    })

    act(() => {
      historyCapture.current!.commitUndo()
    })
    expect(historyCapture.current?.undoEntry).toMatchObject({
      provenance: { source: 'agent' },
    })
  })

  it('records agent and MCP undo on the active preview slide, not slide 1', async () => {
    previewState.activeSlideIndex = 5
    persistenceState.refreshActiveDeck.mockResolvedValue({
      id: 'deck-1',
      html: '<html>mcp</html>',
      title: 'Deck',
      documentRevision: 2,
    })
    renderWithRouter(<App />)
    await waitFor(() => {
      expect(generationFlowCapture.onGenerationSucceeded).toEqual(expect.any(Function))
      expect(externalUpdateListener).toEqual(expect.any(Function))
    })

    act(() => {
      generationFlowCapture.onGenerationSucceeded?.({
        beforeHtml: '<html>after</html>',
        afterHtml: '<html>agent</html>',
        deckChanged: true,
      })
    })
    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        slideIndex: 5,
        provenance: { source: 'agent' },
      })
    })

    act(() =>
      externalUpdateListener?.({
        deckId: 'deck-1',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Codex',
        toolName: 'edit_deck',
        summary: 'Updated after the agent.',
      }),
    )
    await waitFor(() => {
      expect(historyCapture.current?.undoEntry).toMatchObject({
        slideIndex: 5,
        provenance: { source: 'external' },
      })
    })
  })

  it('queues an external update while a local save is in flight', async () => {
    persistenceState.isSaving = true
    persistenceState.refreshActiveDeck.mockResolvedValue({
      id: 'deck-1',
      html: '<html>external</html>',
      title: 'Deck',
      documentRevision: 2,
    })
    const { rerender } = renderWithRouter(<App />)
    await waitFor(() => expect(externalUpdateListener).toEqual(expect.any(Function)))

    act(() =>
      externalUpdateListener?.({
        deckId: 'deck-1',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Claude Code',
        toolName: 'patch_deck',
        summary: 'Patched one slide.',
      }),
    )
    expect(persistenceState.refreshActiveDeck).not.toHaveBeenCalled()

    persistenceState.isSaving = false
    rerender(<App />)
    await waitFor(() => expect(persistenceState.refreshActiveDeck).toHaveBeenCalledWith('deck-1'))
  })

  it('ignores external updates for a deck that is not visible', async () => {
    renderWithRouter(<App />)
    await waitFor(() => expect(externalUpdateListener).toEqual(expect.any(Function)))

    act(() =>
      externalUpdateListener?.({
        deckId: 'deck-2',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Codex',
        toolName: 'edit_deck',
        summary: 'Edited another deck.',
      }),
    )

    expect(persistenceState.refreshActiveDeck).not.toHaveBeenCalled()
  })
})
