import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/test/render-with-router'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const chatPanelProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }))
const deckPreviewLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
const persistenceState = vi.hoisted(() => ({ deckId: 'deck-1' as string | null }))
const generationState = vi.hoisted(() => ({ generateDeck: vi.fn() }))
const assetApi = vi.hoisted(() => ({
  deleteAsset: vi.fn(),
  listDeckAssets: vi.fn().mockResolvedValue([]),
  readFileAsDataUrl: vi.fn(),
  uploadDeckAsset: vi.fn(),
  uploadTemporaryAsset: vi.fn(),
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
    activeVersionId: 'version-1',
    clearVersionPreview: vi.fn(),
    hasDeck: true,
    html: '<html></html>',
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
    rollbackToVersion: vi.fn(),
    saveError: '',
    selectDeck: vi.fn(),
    startNewDeck: vi.fn(),
    versionNumber: 1,
    versions: [],
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

  it('keeps the mobile preview and agent instance mounted while the sheet closes', () => {
    mediaState.isDesktop = false
    const { container, getByTestId } = renderWithRouter(<App />)

    expect(getByTestId('deck-preview')).toBeInTheDocument()
    expect(getByTestId('chat-panel')).toBeInTheDocument()
    fireEvent.click(getByTestId('toggle-chat'))

    expect(container.ownerDocument.querySelectorAll('[data-testid="chat-panel"]')).toHaveLength(1)
    expect(deckPreviewLifecycle).toEqual({ mounts: 1, unmounts: 0 })
  })

  it('stages first-prompt images and forwards their asset ids to new-deck generation', async () => {
    persistenceState.deckId = null
    assetApi.uploadTemporaryAsset.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000701',
      deckId: null,
      chatMessageId: null,
      filename: 'hero.avif',
      mediaType: 'image/avif',
      category: 'image',
      byteSize: 128,
      checksum: 'abc',
      source: 'upload',
      storageKind: 'local',
      url: '/api/assets/00000000-0000-4000-8000-000000000701',
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

    expect(assetApi.uploadTemporaryAsset).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'hero.avif', mediaType: 'image/avif' }),
    )
    expect(generationState.generateDeck).toHaveBeenCalledWith(
      'Use this as the hero image',
      [
        expect.objectContaining({
          assetId: '00000000-0000-4000-8000-000000000701',
          url: '/api/assets/00000000-0000-4000-8000-000000000701',
        }),
      ],
      expect.objectContaining({
        assetIds: ['00000000-0000-4000-8000-000000000701'],
      }),
    )
  })

  it('surfaces first-prompt attachment staging failures', async () => {
    persistenceState.deckId = null
    assetApi.uploadTemporaryAsset.mockRejectedValueOnce(new Error('Unsupported image format.'))
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
