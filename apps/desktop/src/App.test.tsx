import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDesktopSettingsForTests } from '@/lib/ui/desktop-settings'
import { useChatStore } from '@/state/chat-store.ts'
import { getTestLocalStorage } from '@/test/storage'
import { renderWithRouter } from '@/test/render-with-router'
import type { ChatMessage } from '@ark/chat/chat.ts'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))
const chatPanelProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }))
const deckPreviewLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
const deckPreviewRenders = vi.hoisted(() => ({ count: 0 }))
const persistenceState = vi.hoisted(() => ({
  deckId: 'deck-1' as string | null,
  origin: 'authored' as 'blank' | 'authored' | null,
}))
const persistenceCallbacks = vi.hoisted(() => ({
  patchDeckOperations: vi.fn(),
  refreshActiveDeck: vi.fn(),
  ensureBlankDeck: vi.fn(async () => 'deck-new'),
}))
const generationState = vi.hoisted(() => ({
  cancelGeneration: vi.fn(),
  generateDeck: vi.fn(),
  isGenerating: false,
}))
const chatSessionState = vi.hoisted(() => ({ messages: [] as Array<Record<string, unknown>> }))
const assetApi = vi.hoisted(() => ({
  uploadDeckAsset: vi.fn(),
}))

vi.mock('@/lib/api/asset-api', () => assetApi)

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
    origin: persistenceState.origin,
    decks: [],
    deleteActiveDeck: vi.fn(),
    patchDeckOperations: persistenceCallbacks.patchDeckOperations,
    persistHtml: vi.fn(),
    refreshActiveDeck: persistenceCallbacks.refreshActiveDeck,
    renameActiveDeck: vi.fn(),
    saveError: '',
    selectDeck: vi.fn(),
    startNewDeck: vi.fn(),
    ensureBlankDeck: persistenceCallbacks.ensureBlankDeck,
  }),
}))

vi.mock('@/hooks/useChatSession', () => ({
  useChatSession: () => ({
    appendMessage: vi.fn(),
    getMessageDeliveryStatus: vi.fn(),
    messages: chatSessionState.messages,
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
    cancelGeneration: generationState.cancelGeneration,
    failedJobId: null,
    generateDeck: generationState.generateDeck,
    generationError: '',
    generationStatus: generationState.isGenerating ? 'running' : null,
    isGenerating: generationState.isGenerating,
    retryGeneration: vi.fn(),
  }),
}))

vi.mock('@/components/AppTitleBar', () => ({
  AppTitleBar: ({ onToggleChat }: { onToggleChat: () => void }) => (
    <button
      aria-controls="ark-chat-panel"
      data-testid="toggle-chat"
      type="button"
      onClick={onToggleChat}
    >
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

vi.mock('@/components/ChatPanel', async () => {
  const { usePromptSubmit } = await import('@/hooks/usePromptSubmit')
  const { useWorkspaceRuntimeContext } = await import('@/hooks/workspace-runtime-context')
  const { useChatStore } = await import('@/state/chat-store.ts')
  const { useShellStore } = await import('@/state/shell-store.ts')

  return {
    ChatPanel: (props: Record<string, unknown>) => {
      const prompt = usePromptSubmit()
      const { generation, models } = useWorkspaceRuntimeContext()
      const input = useChatStore((state) => state.input)
      const setInput = useChatStore((state) => state.setInput)
      const attachmentError = useChatStore((state) => state.attachmentError)
      const agentInteractionsInModal = useShellStore((state) => state.agentInteractionsInModal)
      const layout = typeof props.layout === 'string' ? props.layout : 'sidebar'
      chatPanelProps.calls.push({
        ...props,
        attachmentError,
        generationState: {
          canGenerate: models.canGenerate,
          isGenerating: generation.isGenerating,
        },
        input,
        interactiveToolsInModal: agentInteractionsInModal && layout !== 'home',
        onInputChange: setInput,
        onPromptSubmit: prompt.handlePromptSubmit,
        onQueuedSendAll: prompt.sendQueuedAll,
        onQueuedSendDismiss: prompt.dismissQueuedSend,
        onQueuedSendEdit: prompt.updateQueuedText,
        onQueuedSendNow: prompt.sendQueuedNow,
        queuedSends: prompt.queuedSends,
      })
      return <div data-testid="chat-panel" />
    },
  }
})

const { default: App } = await import('./App')

describe('App chat panel layout', () => {
  beforeEach(() => {
    persistenceState.deckId = 'deck-1'
    persistenceState.origin = 'authored'
    chatPanelProps.calls = []
    deckPreviewLifecycle.mounts = 0
    deckPreviewLifecycle.unmounts = 0
    deckPreviewRenders.count = 0
    chatSessionState.messages = []
    generationState.isGenerating = false
    resetDesktopSettingsForTests()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a single chat panel in the desktop layout', () => {
    mediaState.isDesktop = true
    const { getAllByTestId } = renderWithRouter(<App />)

    expect(getAllByTestId('chat-panel')).toHaveLength(1)
    expect(screen.getByTestId('deck-preview')).toBeInTheDocument()
  })

  it('keeps a blank deck on the creation chat until it is authored', () => {
    mediaState.isDesktop = true
    persistenceState.origin = 'blank'
    renderWithRouter(<App />)

    expect(screen.getByTestId('creation-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('deck-preview')).not.toBeInTheDocument()
  })

  it('renders a single chat panel in the mobile layout', () => {
    mediaState.isDesktop = false
    const { getAllByTestId } = renderWithRouter(<App />)

    expect(getAllByTestId('chat-panel')).toHaveLength(1)
  })

  it('shows an MCP interaction over the app when the chat panel is closed', async () => {
    mediaState.isDesktop = true
    getTestLocalStorage().setItem('ark:chat-open', '0')
    window.arkDesktop.mcp.getPendingInteraction = vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      deckId: 'deck-1',
      baseDocumentRevision: 1,
      clientName: 'Codex',
      createdAt: '2026-08-06T12:00:00.000Z',
      expiresAt: '2026-08-06T12:30:00.000Z',
      kind: 'questions',
      request: {
        title: 'Shape the deck',
        questions: [
          {
            id: 'audience',
            question: 'Who is the audience?',
            type: 'single',
            options: ['Board', 'Customers'],
          },
        ],
      },
    })

    renderWithRouter(<App />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Codex needs your input')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument()
  })

  it('routes normal agent interactions to the modal when enabled', async () => {
    mediaState.isDesktop = true
    resetDesktopSettingsForTests({ agentInteractionsInModal: true })
    chatSessionState.messages = [
      { id: 'u1', role: 'user', content: 'Build a deck' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'A question first',
        parts: [
          {
            type: 'tool-call',
            toolName: 'ask_user',
            input: {
              title: 'Shape the deck',
              questions: [
                {
                  id: 'audience',
                  question: 'Who is the audience?',
                  type: 'single',
                  options: ['Board', 'Customers'],
                },
              ],
            },
          },
        ],
      },
    ]
    useChatStore.setState({ messages: chatSessionState.messages as ChatMessage[] })

    renderWithRouter(<App />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getAllByText('Shape the deck').length).toBeGreaterThan(0)
    expect(chatPanelProps.calls.at(-1)?.interactiveToolsInModal).toBe(true)
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

  it('restores a persisted closed chat panel on desktop', () => {
    mediaState.isDesktop = true
    getTestLocalStorage().setItem('ark:chat-open', '0')
    const { queryByTestId } = renderWithRouter(<App />)

    expect(queryByTestId('chat-panel')).not.toBeInTheDocument()
  })

  it('keeps a persisted open chat on mobile (layout collapse does not override it)', () => {
    mediaState.isDesktop = false
    getTestLocalStorage().setItem('ark:chat-open', '1')
    const { getByTestId } = renderWithRouter(<App />)

    expect(getByTestId('deck-preview')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'open',
    )
  })

  it('persists the chat panel preference when toggled', () => {
    mediaState.isDesktop = true
    const { getByTestId } = renderWithRouter(<App />)

    fireEvent.click(getByTestId('toggle-chat'))
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('0')

    fireEvent.click(getByTestId('toggle-chat'))
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('1')
  })

  it('toggles the chat panel with the Ctrl/Cmd+B shortcut', () => {
    mediaState.isDesktop = true
    const { getByTestId, queryByTestId } = renderWithRouter(<App />)

    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    expect(queryByTestId('chat-panel')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'B', ctrlKey: true })
    expect(getByTestId('chat-panel')).toBeInTheDocument()
  })

  it('ignores the chat panel shortcut while typing', () => {
    mediaState.isDesktop = true
    const { getByTestId } = renderWithRouter(<App />)
    const input = document.createElement('input')
    document.body.appendChild(input)

    fireEvent.keyDown(input, { key: 'b', metaKey: true })

    expect(getByTestId('chat-panel')).toBeInTheDocument()
    input.remove()
  })

  it('closes the mobile agent drawer from its in-drawer close button and persists', () => {
    mediaState.isDesktop = false
    const { getByTestId } = renderWithRouter(<App />)

    fireEvent.click(getByTestId('toggle-chat'))
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'open',
    )

    const closeButton = document.querySelector('button[aria-label="Close"]')
    expect(closeButton).not.toBeNull()
    fireEvent.click(closeButton!)

    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('0')
  })

  it('does not persist the auto-close when the layout collapses to mobile', () => {
    mediaState.isDesktop = true
    getTestLocalStorage().setItem('ark:chat-open', '1')
    const { rerender } = renderWithRouter(<App />)
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('1')

    mediaState.isDesktop = false
    rerender(<App />)

    // The drawer mounts closed (no open flash), and the collapse is a layout
    // accommodation, so the stored user preference survives.
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('1')
  })

  it('keeps the drawer closed across repeated layout jitter after the user closes it', () => {
    mediaState.isDesktop = false
    getTestLocalStorage().setItem('ark:chat-open', '1')
    const { rerender } = renderWithRouter(<App />)

    // Starts open from the persisted preference, then the user closes it once.
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'open',
    )
    fireEvent.click(document.querySelector('button[aria-label="Close"]')!)
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('0')

    // Drag jitter across the breakpoint must not make the drawer come back.
    mediaState.isDesktop = true
    rerender(<App />)
    mediaState.isDesktop = false
    rerender(<App />)
    mediaState.isDesktop = true
    rerender(<App />)
    mediaState.isDesktop = false
    rerender(<App />)

    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('0')
  })

  it('keeps the drawer closed when the titlebar toggle is clicked (full pointer/focus/click sequence)', async () => {
    mediaState.isDesktop = false
    const { getByTestId } = renderWithRouter(<App />)
    // Radix attaches its pointerdown-outside listener asynchronously (setTimeout 0).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // Open the drawer first.
    fireEvent.click(getByTestId('toggle-chat'))
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'open',
    )

    // A real click begins with pointerdown and a focus change on the button. Without the
    // outside-dismiss guard those dismiss the drawer, and the click then reopens it.
    fireEvent.pointerDown(getByTestId('toggle-chat'))
    fireEvent.focusIn(getByTestId('toggle-chat'))
    fireEvent.click(getByTestId('toggle-chat'))

    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('0')
  })

  it('keeps the stored chat preference when outside clicks land while the drawer is closed', async () => {
    mediaState.isDesktop = true
    getTestLocalStorage().setItem('ark:chat-open', '1')
    const { rerender } = renderWithRouter(<App />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // Collapse to mobile: drawer closes as an accommodation, preference intact.
    mediaState.isDesktop = false
    rerender(<App />)
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveAttribute(
      'data-state',
      'closed',
    )
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('1')

    // Clicking the deck while the (force-mounted) drawer is closed must not clobber it.
    fireEvent.pointerDown(document.body)
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('1')
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

  it('creates a workspace on the first prompt before uploading attachments', async () => {
    persistenceState.deckId = null
    persistenceState.origin = 'blank'
    assetApi.uploadDeckAsset.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000702',
      deckId: 'deck-new',
      chatMessageId: null,
      filename: 'data.csv',
      mediaType: 'text/csv',
      category: 'document',
      byteSize: 2,
      checksum: 'abc',
      source: 'upload',
      storageKind: 'sqlite',
      url: '/api/decks/deck-new/assets/00000000-0000-4000-8000-000000000702',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    renderWithRouter(<App />, { initialEntry: '/', path: '/' })

    const props = chatPanelProps.calls.at(-1)
    expect((props?.generationState as { canGenerate: boolean }).canGenerate).toBe(true)

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

    expect(persistenceCallbacks.ensureBlankDeck).toHaveBeenCalledTimes(1)
    expect(assetApi.uploadDeckAsset).toHaveBeenCalledWith(
      'deck-new',
      expect.objectContaining({ filename: 'data.csv', mediaType: 'text/csv' }),
    )
    expect(generationState.generateDeck).toHaveBeenCalledWith(
      'Start a deck from this CSV',
      [
        expect.objectContaining({
          assetId: '00000000-0000-4000-8000-000000000702',
        }),
      ],
      expect.objectContaining({
        deckId: 'deck-new',
      }),
    )
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

describe('App chat send queue', () => {
  beforeEach(() => {
    mediaState.isDesktop = true
    persistenceState.deckId = 'deck-1'
    persistenceState.origin = 'authored'
    chatPanelProps.calls = []
    generationState.isGenerating = false
    resetDesktopSettingsForTests()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function submitPrompt(text: string) {
    const onPromptSubmit = chatPanelProps.calls.at(-1)?.onPromptSubmit as (
      message: unknown,
    ) => Promise<void>
    await act(async () => {
      await onPromptSubmit({ text, files: [] })
    })
  }

  function latestQueuedSends() {
    return (chatPanelProps.calls.at(-1)?.queuedSends ?? []) as Array<{
      id: string
      text: string
      attachmentCount: number
    }>
  }

  it('sends immediately through generateDeck when idle', async () => {
    renderWithRouter(<App />)

    await submitPrompt('make slides')

    expect(generationState.generateDeck).toHaveBeenCalledTimes(1)
    expect(generationState.generateDeck).toHaveBeenCalledWith(
      'make slides',
      [],
      expect.objectContaining({ deckId: 'deck-1' }),
    )
    expect(latestQueuedSends()).toEqual([])
  })

  it.each([
    { origin: 'authored' as const, layout: 'sidebar', name: 'sidebar' },
    { origin: 'blank' as const, layout: 'home', name: 'home' },
  ])(
    'enqueues a busy send as a chip in the $name shell without a second job or cancel',
    async ({ origin, layout }) => {
      persistenceState.origin = origin
      generationState.isGenerating = true
      renderWithRouter(<App />)

      expect(chatPanelProps.calls.at(-1)?.layout).toBe(layout)
      await submitPrompt('queue this follow-up')

      expect(generationState.generateDeck).not.toHaveBeenCalled()
      expect(generationState.cancelGeneration).not.toHaveBeenCalled()
      expect(latestQueuedSends()).toEqual([
        expect.objectContaining({ text: 'queue this follow-up', attachmentCount: 0 }),
      ])
    },
  )

  it('flushes queued chips one turn at a time through generateDeck once idle', async () => {
    generationState.isGenerating = true
    const { rerender } = renderWithRouter(<App />)

    await submitPrompt('first follow-up')
    await submitPrompt('second follow-up')
    expect(generationState.generateDeck).not.toHaveBeenCalled()
    expect(latestQueuedSends().map((item) => item.text)).toEqual([
      'first follow-up',
      'second follow-up',
    ])

    generationState.isGenerating = false
    rerender(<App />)

    await waitFor(() => {
      expect(generationState.generateDeck).toHaveBeenCalledTimes(2)
    })
    expect(generationState.generateDeck.mock.calls.map((call) => call[0])).toEqual([
      'first follow-up',
      'second follow-up',
    ])
    expect(latestQueuedSends()).toEqual([])
  })

  it('Send now while busy fronts that chip; idle dequeues it first into generateDeck', async () => {
    generationState.isGenerating = true
    const { rerender } = renderWithRouter(<App />)

    await submitPrompt('keep in place')
    await submitPrompt('send me next')
    const sendNow = chatPanelProps.calls.at(-1)?.onQueuedSendNow as (id: string) => void
    const nextId = latestQueuedSends().find((item) => item.text === 'send me next')?.id
    expect(nextId).toBeDefined()

    await act(async () => {
      sendNow(nextId!)
    })

    expect(generationState.generateDeck).not.toHaveBeenCalled()
    expect(latestQueuedSends().map((item) => item.text)).toEqual(['send me next', 'keep in place'])

    generationState.isGenerating = false
    rerender(<App />)

    await waitFor(() => {
      expect(generationState.generateDeck).toHaveBeenCalledTimes(2)
    })
    expect(generationState.generateDeck.mock.calls.map((call) => call[0])).toEqual([
      'send me next',
      'keep in place',
    ])
  })

  it('Send all while busy leaves chips for the idle generateDeck flush in order', async () => {
    generationState.isGenerating = true
    const { rerender } = renderWithRouter(<App />)

    await submitPrompt('one')
    await submitPrompt('two')
    const sendAll = chatPanelProps.calls.at(-1)?.onQueuedSendAll as () => void

    await act(async () => {
      sendAll()
    })
    expect(generationState.generateDeck).not.toHaveBeenCalled()
    expect(latestQueuedSends().map((item) => item.text)).toEqual(['one', 'two'])

    generationState.isGenerating = false
    rerender(<App />)

    await waitFor(() => {
      expect(generationState.generateDeck).toHaveBeenCalledTimes(2)
    })
    expect(generationState.generateDeck.mock.calls.map((call) => call[0])).toEqual(['one', 'two'])
  })

  it('dismiss and edit update parked chips before the idle flush', async () => {
    generationState.isGenerating = true
    const { rerender } = renderWithRouter(<App />)

    await submitPrompt('drop me')
    await submitPrompt('edit me')
    const queued = latestQueuedSends()
    const dismiss = chatPanelProps.calls.at(-1)?.onQueuedSendDismiss as (id: string) => void
    const edit = chatPanelProps.calls.at(-1)?.onQueuedSendEdit as (id: string, text: string) => void

    act(() => {
      dismiss(queued[0]!.id)
      edit(queued[1]!.id, 'edited copy')
    })

    expect(latestQueuedSends()).toEqual([
      expect.objectContaining({ id: queued[1]!.id, text: 'edited copy' }),
    ])

    generationState.isGenerating = false
    rerender(<App />)

    await waitFor(() => {
      expect(generationState.generateDeck).toHaveBeenCalledTimes(1)
    })
    expect(generationState.generateDeck).toHaveBeenCalledWith(
      'edited copy',
      [],
      expect.objectContaining({ deckId: 'deck-1' }),
    )
  })
})
