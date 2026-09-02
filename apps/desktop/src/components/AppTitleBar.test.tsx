import { type ComponentProps, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import {
  WorkspaceRuntimeContext,
  type WorkspaceRuntimeValue,
} from '@/hooks/workspace-runtime-context'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'
import { useShellStore } from '@/state/shell-store.ts'

import { AppTitleBar } from './AppTitleBar'

const fileActionMocks = vi.hoisted(() => ({
  handleDownload: vi.fn(),
  handleDuplicate: vi.fn(),
  handleMove: vi.fn(),
  handleNewDeck: vi.fn(),
  handleOpenWorkspace: vi.fn(),
  handleRenameDeck: vi.fn(),
  handleSaveAs: vi.fn(),
  handleShareProject: vi.fn(),
  handleHtmlUpload: vi.fn(),
  handlePptxImportClick: vi.fn(),
  handlePptxUpload: vi.fn(),
  handleUploadClick: vi.fn(),
}))

const exportMocks = vi.hoisted(() => ({
  handleExport: vi.fn(),
  exportingDeck: false as false | 'pdf' | 'pptx',
}))

vi.mock('@/hooks/useWorkspaceFileActions', () => ({
  useWorkspaceFileActions: () => ({
    refs: { fileInputRef: { current: null }, pptxFileInputRef: { current: null } },
    handleNewDeck: fileActionMocks.handleNewDeck,
    handleOpenWorkspace: fileActionMocks.handleOpenWorkspace,
    handleSaveAs: fileActionMocks.handleSaveAs,
    handleMove: fileActionMocks.handleMove,
    handleDuplicate: fileActionMocks.handleDuplicate,
    handleShareProject: fileActionMocks.handleShareProject,
    importDeck: {
      handlePptxUpload: fileActionMocks.handlePptxUpload,
      handlePptxImportClick: fileActionMocks.handlePptxImportClick,
      handleHtmlUpload: fileActionMocks.handleHtmlUpload,
      handleUploadClick: fileActionMocks.handleUploadClick,
    },
    handleDownload: fileActionMocks.handleDownload,
    handleRenameDeck: fileActionMocks.handleRenameDeck,
  }),
}))

vi.mock('@/hooks/useDeckExport', () => ({
  useDeckExport: () => ({
    handleExport: exportMocks.handleExport,
    exportingDeck: exportMocks.exportingDeck,
  }),
}))

const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  title: 'Test Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const SLIDE_HTML = '<html><body><section class="slide">Hello</section></body></html>'
const SCRIPT_HTML =
  '<html><body><section class="slide">Hello</section><script>window.x=1</script></body></html>'

function EditorRuntime({ children }: { children: ReactNode }) {
  const value = {
    models: { loadModels: vi.fn(), warnings: [] },
    deckPreviewRef: { current: { openPresent: vi.fn(), getActiveSlideIndex: () => 0 } },
  } as unknown as WorkspaceRuntimeValue

  return (
    <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>
  )
}

function seedEditorStores(
  options: {
    html?: string
    isChatOpen?: boolean
    isStripOpen?: boolean
    exportingDeck?: false | 'pdf' | 'pptx'
    appearancePreference?: 'system' | 'light' | 'dark'
  } = {},
) {
  useDeckStore.setState({
    deckId: deck.id,
    deckTitle: deck.title,
    html: options.html ?? SLIDE_HTML,
    savedHtml: options.html ?? SLIDE_HTML,
  })
  useEditorStore.setState({ isStripOpen: options.isStripOpen ?? false })
  useShellStore.setState({
    isChatOpen: options.isChatOpen ?? false,
    exportingDeck: options.exportingDeck ?? false,
    appearancePreference: options.appearancePreference ?? 'system',
  })
  useChatStore.setState({ isGenerating: false })
  exportMocks.exportingDeck = options.exportingDeck ?? false
}

function renderTitleBar(
  overrides: Partial<ComponentProps<typeof AppTitleBar>> = {},
  storeOptions: Parameters<typeof seedEditorStores>[0] = {},
) {
  const variant = overrides.variant ?? 'editor'

  if (variant === 'editor') {
    seedEditorStores(storeOptions)
  }

  render(
    <MemoryRouter>
      <TooltipProvider>
        {variant === 'editor' ? (
          <EditorRuntime>
            <AppTitleBar {...overrides} />
          </EditorRuntime>
        ) : (
          <AppTitleBar {...overrides} />
        )}
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe('AppTitleBar accessibility', () => {
  beforeEach(() => {
    window.arkDesktop = {
      mcp: window.arkDesktop.mcp,
      credentials: {
        list: vi.fn().mockResolvedValue({
          openai: { configured: false, storage: null },
          anthropic: { configured: false, storage: null },
          google: { configured: false, storage: null },
          openrouter: { configured: false, storage: null },
        }),
        save: vi.fn(),
        saveSession: vi.fn(),
        remove: vi.fn(),
        test: vi.fn(),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ defaultWorkspaceDirectory: null }),
        update: vi.fn(),
      },
      updates: { check: vi.fn() },
      export: { create: vi.fn() },
      files: {
        openWorkspace: vi.fn(),
        chooseWorkspacePath: vi.fn(),
        chooseDirectory: vi.fn(),
        reveal: vi.fn(),
      },
    }
  })

  it('omits deck save status and version labels', () => {
    renderTitleBar()

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.queryByText('New deck')).not.toBeInTheDocument()
    expect(screen.queryByText(/v1/)).not.toBeInTheDocument()
  })

  it('selects an appearance from Settings', async () => {
    const user = userEvent.setup()
    const onAppearanceChange = vi.fn()
    const original = useShellStore.getState().setAppearancePreference
    useShellStore.setState({
      setAppearancePreference: (preference) => {
        onAppearanceChange(preference)
        original(preference)
      },
    })
    renderTitleBar()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Dark theme'))

    expect(onAppearanceChange).toHaveBeenCalledWith('dark')
  })

  it('does not expose aria-pressed on non-toggle action buttons', () => {
    renderTitleBar()

    expect(screen.getByRole('button', { name: 'Test Deck' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'New' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Export deck' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Upload HTML' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Import PowerPoint' })).not.toHaveAttribute(
      'aria-pressed',
    )
    expect(screen.getByRole('button', { name: 'Present fullscreen' })).not.toHaveAttribute(
      'aria-pressed',
    )
  })

  it('does not visually change title-bar controls on hover', () => {
    renderTitleBar()

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('hover:!bg-transparent')
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('active:!translate-y-0')
    expect(screen.getByRole('button', { name: 'Test Deck' })).toHaveClass('hover:!bg-transparent')
  })

  it('marks New as the current workspace tab on the creation home', () => {
    renderTitleBar({ variant: 'home', navActive: 'new' })

    expect(screen.getByText('New')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Slides' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('button', { name: 'Present fullscreen' })).not.toBeInTheDocument()
  })

  it('marks Slides as the current workspace tab on the library', () => {
    renderTitleBar({ variant: 'library', navActive: 'slides' })

    expect(screen.getByRole('link', { name: 'Slides' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Present fullscreen' })).not.toBeInTheDocument()
  })

  it('shows MCP running with a green light and opens the MCP settings tab', async () => {
    window.arkDesktop.mcp.getStatus = vi.fn().mockResolvedValue({
      state: 'running',
      autoStart: false,
      activeDeckId: deck.id,
      activeDeckTitle: deck.title,
      connectedClient: 'Codex',
      lastActivity: null,
      error: null,
    })
    renderTitleBar()

    const mcpButton = await screen.findByRole('button', { name: 'MCP settings' })
    expect(mcpButton).not.toHaveAttribute('aria-pressed')
    expect(mcpButton).not.toHaveClass('bg-[var(--ark-titlebar-active)]')
    expect(await screen.findByTestId('mcp-running-indicator')).toHaveClass('bg-emerald-500')

    await userEvent.click(mcpButton)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('data-state', 'active')
  })

  it('keeps panel controls unhighlighted and swaps to the icon without an arrow when closed', () => {
    renderTitleBar({}, { isChatOpen: true, isStripOpen: false })

    const chatToggle = screen.getByRole('button', { name: /Hide chat panel/ })
    const stripToggle = screen.getByRole('button', { name: 'Show slide thumbnails' })

    expect(chatToggle).not.toHaveAttribute('aria-pressed')
    expect(chatToggle).toHaveAttribute('aria-expanded', 'true')
    expect(chatToggle).toHaveAttribute('aria-controls', 'ark-chat-panel')
    expect(chatToggle).toHaveClass('aria-expanded:!bg-transparent')
    expect(chatToggle).toHaveClass('hover:!bg-transparent')
    expect(chatToggle.querySelector('svg')).toBeInTheDocument()

    expect(stripToggle).not.toHaveAttribute('aria-pressed')
    expect(stripToggle).toHaveAttribute('aria-expanded', 'false')
    expect(stripToggle).toHaveAttribute('aria-controls', 'ark-slide-strip')
    expect(stripToggle).toHaveClass('aria-expanded:!bg-transparent')
    expect(stripToggle).toHaveClass('hover:!bg-transparent')
    expect(stripToggle.querySelector('svg')).toBeInTheDocument()
  })

  it('supports keyboard activation for titlebar icon buttons', async () => {
    const user = userEvent.setup()
    const onToggleChat = vi.fn()
    renderTitleBar({ onToggleChat })

    const chatToggle = screen.getByRole('button', { name: /Show chat panel/ })
    chatToggle.focus()
    await user.keyboard('{Enter}')

    expect(onToggleChat).toHaveBeenCalledTimes(1)
  })

  it('opens presentation mode from the title bar', async () => {
    const user = userEvent.setup()
    const onPresent = vi.fn()
    const value = {
      models: { loadModels: vi.fn(), warnings: [] },
      deckPreviewRef: { current: { openPresent: onPresent, getActiveSlideIndex: () => 0 } },
    } as unknown as WorkspaceRuntimeValue

    seedEditorStores()
    render(
      <MemoryRouter>
        <TooltipProvider>
          <WorkspaceRuntimeContext.Provider value={value}>
            <AppTitleBar />
          </WorkspaceRuntimeContext.Provider>
        </TooltipProvider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

    expect(onPresent).toHaveBeenCalledOnce()
  })

  it('offers original and sanitized download choices when scripts are present', async () => {
    const user = userEvent.setup()
    const onDownload = fileActionMocks.handleDownload
    renderTitleBar({}, { html: SCRIPT_HTML })

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('Original HTML'))
    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('Sanitized HTML'))

    expect(onDownload).toHaveBeenNthCalledWith(1, 'original')
    expect(onDownload).toHaveBeenNthCalledWith(2, 'sanitized')
  })

  it('offers a PDF export for the open deck', async () => {
    const user = userEvent.setup()
    const onExport = exportMocks.handleExport
    renderTitleBar()

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('PDF'))

    expect(onExport).toHaveBeenCalledWith('pdf')
  })

  it('surfaces PowerPoint export lint copy for each finding class', async () => {
    const user = userEvent.setup()
    renderTitleBar(
      {},
      {
        html: `<html lang="en" data-ark-font-display="inter" data-ark-font-body="calibri" data-ark-font-mono="ibm-plex">
<head><style>
h2 { font-weight: 300; }
.hero { filter: blur(2px); }
p { font-family: "Comic Sans MS", sans-serif; }
</style></head>
<body><section class="slide">Hi</section></body></html>`,
      },
    )

    await user.click(screen.getByRole('button', { name: 'Export deck' }))

    expect(screen.getByText('PowerPoint export notes')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Font weights outside 400/700 will collapse to regular or bold in PowerPoint.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Some CSS has no PowerPoint equivalent and will flatten those regions to pictures.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Literal font-family values bypass --ark-font-* variables, so PowerPoint may pick a different typeface.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Unknown font ids are not in the registry and will not survive PowerPoint export.',
      ),
    ).toBeInTheDocument()
  })

  it('disables the PDF item while an export is already running', async () => {
    const user = userEvent.setup()
    const onExport = exportMocks.handleExport
    renderTitleBar({}, { exportingDeck: 'pdf' })

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('Exporting PDF...'))

    expect(onExport).not.toHaveBeenCalled()
  })

  it('renames the active deck inline from the title', async () => {
    const user = userEvent.setup()
    const onRenameDeck = fileActionMocks.handleRenameDeck
    onRenameDeck.mockResolvedValue(undefined)
    renderTitleBar()

    await user.click(screen.getByRole('button', { name: 'Test Deck' }))
    const input = screen.getByRole('textbox', { name: 'Deck title' })
    await user.clear(input)
    await user.type(input, 'Board plan')
    await user.keyboard('{Enter}')

    expect(onRenameDeck).toHaveBeenCalledWith('Board plan')
  })

  it('cancels inline rename with Escape', async () => {
    const user = userEvent.setup()
    const onRenameDeck = fileActionMocks.handleRenameDeck
    renderTitleBar()

    await user.click(screen.getByRole('button', { name: 'Test Deck' }))
    const input = screen.getByRole('textbox', { name: 'Deck title' })
    await user.clear(input)
    await user.type(input, 'Board plan{Escape}')

    expect(onRenameDeck).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Test Deck' })).toBeInTheDocument()
  })
})
