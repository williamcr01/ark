import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const chatPanelProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }))

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
    deckId: 'deck-1',
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
    generateDeck: vi.fn(),
    generationError: '',
    generationStatus: null,
    isGenerating: false,
    retryGeneration: vi.fn(),
  }),
}))

vi.mock('@/components/AppTitleBar', () => ({
  AppTitleBar: () => <div data-testid="title-bar" />,
}))

vi.mock('@/components/DeckPreview', () => ({
  DeckPreview: () => <div data-testid="deck-preview" />,
}))

vi.mock('@/components/ChatPanel', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    chatPanelProps.calls.push(props)
    return <div data-testid="chat-panel" />
  },
}))

const { default: App } = await import('./App')

describe('App chat panel layout', () => {
  beforeEach(() => {
    chatPanelProps.calls = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a single chat panel in the desktop layout', () => {
    mediaState.isDesktop = true
    const { getAllByTestId } = render(<App />)

    expect(getAllByTestId('chat-panel')).toHaveLength(1)
  })

  it('renders a single chat panel in the mobile layout', () => {
    mediaState.isDesktop = false
    const { getAllByTestId } = render(<App />)

    expect(getAllByTestId('chat-panel')).toHaveLength(1)
  })

  it('passes identical chat panel props in both layouts', () => {
    mediaState.isDesktop = true
    const { unmount } = render(<App />)
    const desktopProps = chatPanelProps.calls.at(-1)
    unmount()

    chatPanelProps.calls = []
    mediaState.isDesktop = false
    render(<App />)
    const mobileProps = chatPanelProps.calls.at(-1)

    expect(desktopProps).toBeDefined()
    expect(mobileProps).toBeDefined()
    expect(Object.keys(desktopProps ?? {}).sort()).toEqual(Object.keys(mobileProps ?? {}).sort())
  })
})
