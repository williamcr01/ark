import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/test/render-with-router'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const chatPanelProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }))
const deckPreviewLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
const deckPreviewRenders = vi.hoisted(() => ({ count: 0 }))
const persistenceState = vi.hoisted(() => ({ deckId: 'deck-1' as string | null }))
const persistenceCallbacks = vi.hoisted(() => ({
  patchDeckOperations: vi.fn(),
  refreshActiveDeck: vi.fn(),
}))
const generationState = vi.hoisted(() => ({ generateDeck: vi.fn() }))
const assetApi = vi.hoisted(() => ({
  uploadDeckAsset: vi.fn(),
}))

vi.mock('@/lib/asset-api', () => assetApi)

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => mediaState.isDesktop,
}))

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => [{ current: null }, { width: 1280, height: 800 }],
}))

vi.mock('@/hooks/useDeckPersistence', () => ({
  useDeckPersistence: () => ({
    hasDeck: true,
    html: '<html></html>',
    isDirty: false,
    isLoading: false,
    isSaving: false,
    isPatching: false,
    deckId: persistenceState.deckId,
    deckTitle: 'Deck',
    decks: [],
    deleteActiveDeck: vi.fn(),
    patchDeckOperations: persistenceCallbacks.patchDeckOperations,
    persistHtml: vi.fn(),
    refreshActiveDeck: persistenceCallbacks.refreshActiveDeck,
    renameActiveDeck: vi.fn(),
    saveError: '',
    selectDeck: vi.fn(),
    startNewDeck: vi.fn(),
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
    generateDeck: generationState.generateDeck,
    generationError: '',
    generationStatus: null,
    isGenerating: false,
    retryGeneration: vi.fn(),
  }),
}))

vi.mock('@/components/AppTitleBar', () => ({
  AppTitleBar: ({ onToggleChat }: { onToggleChat: () => void }) => (
    <button data-testid="toggle-chat" type="button" onClick={onToggleChat}>
      Toggle chat
    </button>
  ),
}))

vi.mock('@/components/DeckPreview', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    DeckPreview: () => {
      deckPreviewRenders.count += 1
      React.useEffect(() => {
        deckPreviewLifecycle.mounts += 1

        return () => {
          deckPreviewLifecycle.unmounts += 1
        }
      }, [])

      return <div data-testid="deck-preview" />
    },
  }
})

vi.mock('@/components/ChatPanel', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    chatPanelProps.calls.push(props)
    return <div data-testid="chat-panel" />
  },
}))

const { default: App } = await import('./App')

describe('App chat panel layout', () => {
  beforeEach(() => {
    persistenceState.deckId = 'deck-1'
    chatPanelProps.calls = []
    deckPreviewLifecycle.mounts = 0
    deckPreviewLifecycle.unmounts = 0
    deckPreviewRenders.count = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a single chat panel in the desktop layout', () => {
    mediaState.isDesktop = true
    const { getAllByTestId } = renderWithRouter(<App />)

    expect(getAllByTestId('chat-panel')).toHaveLength(1)
  })

  it('renders a single chat panel in the mobile layout', () => {
    mediaState.isDesktop = false
    const { getAllByTestId } = renderWithRouter(<App />)

    expect(getAllByTestId('chat-panel')).toHaveLength(1)
  })

  it('passes identical chat panel props in both layouts', () => {
    mediaState.isDesktop = true
    const { unmount } = renderWithRouter(<App />)
    const desktopProps = chatPanelProps.calls.at(-1)
    unmount()

    chatPanelProps.calls = []
    mediaState.isDesktop = false
    renderWithRouter(<App />)
    const mobileProps = chatPanelProps.calls.at(-1)

    expect(desktopProps).toBeDefined()
    expect(mobileProps).toBeDefined()
    expect(Object.keys(desktopProps ?? {}).sort()).toEqual(Object.keys(mobileProps ?? {}).sort())
  })

  it('keeps the desktop preview mounted when chat opens and closes', () => {
    mediaState.isDesktop = true
    const { getByTestId, queryByTestId } = renderWithRouter(<App />)

    expect(getByTestId('deck-preview')).toBeInTheDocument()
    expect(getByTestId('chat-panel')).toBeInTheDocument()
    expect(deckPreviewLifecycle).toEqual({ mounts: 1, unmounts: 0 })

    fireEvent.click(getByTestId('toggle-chat'))

    expect(queryByTestId('chat-panel')).not.toBeInTheDocument()
    expect(getByTestId('deck-preview')).toBeInTheDocument()
    expect(deckPreviewLifecycle).toEqual({ mounts: 1, unmounts: 0 })

    fireEvent.click(getByTestId('toggle-chat'))

    expect(getByTestId('chat-panel')).toBeInTheDocument()
    expect(getByTestId('deck-preview')).toBeInTheDocument()
    expect(deckPreviewLifecycle).toEqual({ mounts: 1, unmounts: 0 })
  })

  it('does not rerender the preview while typing in chat', () => {
    mediaState.isDesktop = true
    renderWithRouter(<App />)
    const renderCount = deckPreviewRenders.count
    const onInputChange = chatPanelProps.calls.at(-1)?.onInputChange as (value: string) => void

    act(() => onInputChange('Make the title shorter'))

    expect(deckPreviewRenders.count).toBe(renderCount)
  })

  it('keeps the mobile preview and agent instance mounted while the sheet closes', () => {
    mediaState.isDesktop = false
    const { container, getByTestId } = renderWithRouter(<App />)

    expect(getByTestId('deck-preview')).toBeInTheDocument()
    // The agent drawer starts closed on mobile but the chat stays mounted (forceMount).
    expect(container.ownerDocument.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    fireEvent.click(getByTestId('toggle-chat'))
    fireEvent.click(getByTestId('toggle-chat'))

    expect(container.ownerDocument.querySelectorAll('[data-testid="chat-panel"]')).toHaveLength(1)
    expect(deckPreviewLifecycle).toEqual({ mounts: 1, unmounts: 0 })
  })

  it('renders the mobile agent drawer without a dimming modal overlay', () => {
    mediaState.isDesktop = false
    const { container, getByTestId } = renderWithRouter(<App />)

    // Non-modal drawer: no dark backdrop covers the deck, and opening the drawer
    // must not add one either.
    fireEvent.click(getByTestId('toggle-chat'))
    expect(container.ownerDocument.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'open',
    )
    expect(container.ownerDocument.querySelector('[class*="ark-overlay"]')).toBeNull()
  })

  it('closes the agent drawer when the layout collapses to mobile', () => {
    mediaState.isDesktop = true
    const { getByTestId, rerender } = renderWithRouter(<App />)

    expect(getByTestId('chat-panel')).toBeInTheDocument()

    mediaState.isDesktop = false
    rerender(<App />)

    const sheet = document.querySelector('[data-slot="sheet-content"]')
    expect(sheet).toHaveAttribute('data-state', 'closed')
    expect(getByTestId('deck-preview')).toBeInTheDocument()
  })

  it('uploads prompt images into the new workspace before generation', async () => {
    assetApi.uploadDeckAsset.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000701',
      deckId: 'deck-1',
      chatMessageId: null,
      filename: 'hero.avif',
      mediaType: 'image/avif',
      category: 'image',
      byteSize: 128,
      checksum: 'abc',
      source: 'upload',
      storageKind: 'sqlite',
      url: '/api/decks/deck-1/assets/00000000-0000-4000-8000-000000000701',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    renderWithRouter(<App />)
    const onPromptSubmit = chatPanelProps.calls.at(-1)?.onPromptSubmit as (
      message: unknown,
    ) => Promise<void>

    await act(async () => {
      await onPromptSubmit({
        text: 'Use this as the hero image',
        files: [
          {
            id: 'file-1',
            filename: 'hero.avif',
            mediaType: 'image/avif',
            url: 'data:image/avif;base64,AAAA',
          },
        ],
      })
    })

    expect(assetApi.uploadDeckAsset).toHaveBeenCalledWith(
      'deck-1',
      expect.objectContaining({ filename: 'hero.avif', mediaType: 'image/avif' }),
    )
    expect(generationState.generateDeck).toHaveBeenCalledWith(
      'Use this as the hero image',
      [
        expect.objectContaining({
          assetId: '00000000-0000-4000-8000-000000000701',
          url: '/api/decks/deck-1/assets/00000000-0000-4000-8000-000000000701',
        }),
      ],
      expect.objectContaining({
        assetIds: ['00000000-0000-4000-8000-000000000701'],
      }),
    )
  })

  it('keeps first-message attachment submission disabled until the workspace exists', async () => {
    persistenceState.deckId = null
    renderWithRouter(<App />)

    const props = chatPanelProps.calls.at(-1)
    expect(props?.canGenerate).toBe(false)

    await act(async () => {
      await (props?.onPromptSubmit as (message: unknown) => Promise<void>)({
        text: 'Start a deck from this CSV',
        files: [
          {
            id: 'file-1',
            filename: 'data.csv',
            mediaType: 'text/csv',
            url: 'data:text/csv;base64,YQ==',
          },
        ],
      })
    })

    expect(assetApi.uploadDeckAsset).not.toHaveBeenCalled()
    expect(generationState.generateDeck).not.toHaveBeenCalled()
  })

  it('surfaces first-prompt attachment staging failures', async () => {
    assetApi.uploadDeckAsset.mockRejectedValueOnce(new Error('Unsupported image format.'))
    renderWithRouter(<App />)
    const onPromptSubmit = chatPanelProps.calls.at(-1)?.onPromptSubmit as (
      message: unknown,
    ) => Promise<void>

    await act(async () => {
      await onPromptSubmit({
        text: 'Use this photo',
        files: [
          {
            id: 'file-1',
            filename: 'photo.heic',
            mediaType: 'image/heic',
            url: 'data:image/heic;base64,AAAA',
          },
        ],
      })
    })

    expect(chatPanelProps.calls.at(-1)?.attachmentError).toBe('Unsupported image format.')
    expect(generationState.generateDeck).not.toHaveBeenCalled()
  })
})
