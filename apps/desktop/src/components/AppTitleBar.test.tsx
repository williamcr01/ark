import { createRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { AppTitleBar } from './AppTitleBar'

const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  title: 'Test Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const DEFAULT_UI_STATE = {
  hasDeck: true,
  hasSlides: true,
  isChatOpen: false,
  isGenerating: false,
  isStripOpen: false,
  showSanitizedDownload: false,
}

function renderTitleBar(overrides: Partial<ComponentProps<typeof AppTitleBar>> = {}) {
  const fileInputRef = createRef<HTMLInputElement>()

  render(
    <MemoryRouter>
      <TooltipProvider>
        <AppTitleBar
          activeDeckId={deck.id}
          deckTitle={deck.title}
          fileInputRef={fileInputRef}
          pptxFileInputRef={createRef<HTMLInputElement>()}
          uiState={DEFAULT_UI_STATE}
          onDownload={vi.fn()}
          onExport={vi.fn()}
          onDuplicate={vi.fn()}
          onHtmlUpload={vi.fn()}
          onPptxUpload={vi.fn()}
          onMove={vi.fn()}
          onNewDeck={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onPresent={vi.fn()}
          onRenameDeck={vi.fn()}
          onReveal={vi.fn()}
          onSaveAs={vi.fn()}
          onShareProject={vi.fn()}
          onToggleChat={vi.fn()}
          onToggleStrip={vi.fn()}
          onUploadClick={vi.fn()}
          onPptxImportClick={vi.fn()}
          {...overrides}
        />
      </TooltipProvider>
    </MemoryRouter>,
  )

  return { fileInputRef }
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
    renderTitleBar({ appearancePreference: 'system', onAppearanceChange })

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
    expect(screen.getByTestId('mcp-running-indicator')).toHaveClass('bg-emerald-500')

    await userEvent.click(mcpButton)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('data-state', 'active')
  })

  it('keeps panel controls unhighlighted and swaps to the icon without an arrow when closed', () => {
    renderTitleBar({ uiState: { ...DEFAULT_UI_STATE, isChatOpen: true, isStripOpen: false } })

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
    renderTitleBar({ onPresent })

    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

    expect(onPresent).toHaveBeenCalledOnce()
  })

  it('offers original and sanitized download choices when scripts are present', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    renderTitleBar({ onDownload, uiState: { ...DEFAULT_UI_STATE, showSanitizedDownload: true } })

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('Original HTML'))
    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('Sanitized HTML'))

    expect(onDownload).toHaveBeenNthCalledWith(1, 'original')
    expect(onDownload).toHaveBeenNthCalledWith(2, 'sanitized')
  })

  it('offers a PDF export for the open deck', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    renderTitleBar({ onExport })

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('PDF'))

    expect(onExport).toHaveBeenCalledWith('pdf')
  })

  it('surfaces PowerPoint export lint copy for each finding class', async () => {
    const user = userEvent.setup()
    renderTitleBar({
      exportLint: [
        {
          code: 'font-weight-unsafe',
          message: 'Font weights outside 400/700 will collapse to regular or bold in PowerPoint.',
          count: 1,
        },
        {
          code: 'flatten-to-picture',
          message:
            'Some CSS has no PowerPoint equivalent and will flatten those regions to pictures.',
          count: 1,
        },
        {
          code: 'literal-font-family',
          message:
            'Literal font-family values bypass --ark-font-* variables, so PowerPoint may pick a different typeface.',
          count: 1,
        },
        {
          code: 'unknown-font-id',
          message:
            'Unknown font ids are not in the registry and will not survive PowerPoint export.',
          count: 1,
        },
      ],
    })

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
    const onExport = vi.fn()
    renderTitleBar({ onExport, exportingDeck: 'pdf' })

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('Exporting PDF...'))

    expect(onExport).not.toHaveBeenCalled()
  })

  it('renames the active deck inline from the title', async () => {
    const user = userEvent.setup()
    const onRenameDeck = vi.fn().mockResolvedValue(undefined)
    renderTitleBar({ onRenameDeck })

    await user.click(screen.getByRole('button', { name: 'Test Deck' }))
    const input = screen.getByRole('textbox', { name: 'Deck title' })
    await user.clear(input)
    await user.type(input, 'Board plan')
    await user.keyboard('{Enter}')

    expect(onRenameDeck).toHaveBeenCalledWith('Board plan')
  })

  it('cancels inline rename with Escape', async () => {
    const user = userEvent.setup()
    const onRenameDeck = vi.fn()
    renderTitleBar({ onRenameDeck })

    await user.click(screen.getByRole('button', { name: 'Test Deck' }))
    const input = screen.getByRole('textbox', { name: 'Deck title' })
    await user.clear(input)
    await user.type(input, 'Board plan{Escape}')

    expect(onRenameDeck).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Test Deck' })).toBeInTheDocument()
  })
})
