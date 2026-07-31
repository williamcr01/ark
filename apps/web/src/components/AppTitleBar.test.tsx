import { createRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { AppTitleBar } from './AppTitleBar'

const deck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  title: 'Test Deck',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderTitleBar(overrides: Partial<ComponentProps<typeof AppTitleBar>> = {}) {
  const fileInputRef = createRef<HTMLInputElement>()

  render(
    <MemoryRouter>
      <TooltipProvider>
        <AppTitleBar
          activeDeckId={deck.id}
          activeVersionId="a0000000-0000-4000-8000-000000000001"
          deckSaveStatus="saved"
          deckTitle={deck.title}
          fileInputRef={fileInputRef}
          hasDeck
          hasSlides
          isChatOpen={false}
          isGenerating={false}
          isLoadingVersions={false}
          isStripOpen={false}
          onClearVersionPreview={vi.fn()}
          onDownload={vi.fn()}
          onHtmlUpload={vi.fn()}
          onInspectVersion={vi.fn()}
          onNewDeck={vi.fn()}
          onPresent={vi.fn()}
          onRefreshVersions={vi.fn().mockResolvedValue([])}
          onRenameDeck={vi.fn()}
          onRollbackVersion={vi.fn()}
          onToggleChat={vi.fn()}
          onToggleStrip={vi.fn()}
          onUploadClick={vi.fn()}
          previewVersion={null}
          showSanitizedDownload={false}
          versionNumber={1}
          versions={[]}
          {...overrides}
        />
      </TooltipProvider>
    </MemoryRouter>,
  )

  return { fileInputRef }
}

describe('AppTitleBar accessibility', () => {
  it('selects an appearance from the keyboard-accessible menu', async () => {
    const user = userEvent.setup()
    const onAppearanceChange = vi.fn()
    renderTitleBar({ appearancePreference: 'system', onAppearanceChange })

    const appearanceButton = screen.getByRole('button', { name: 'Theme' })
    expect(appearanceButton).toHaveTextContent('Theme')
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument()
    await user.click(appearanceButton)
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }))

    expect(onAppearanceChange).toHaveBeenCalledWith('dark')
  })

  it('does not expose aria-pressed on non-toggle action buttons', () => {
    renderTitleBar()

    expect(screen.getByRole('button', { name: 'Test Deck' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'New deck' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Download HTML' })).not.toHaveAttribute(
      'aria-pressed',
    )
    expect(screen.getByRole('button', { name: 'Upload HTML' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Present fullscreen' })).not.toHaveAttribute(
      'aria-pressed',
    )
  })

  it('exposes pressed and expanded state only on panel toggle buttons', () => {
    renderTitleBar({ isChatOpen: true, isStripOpen: false })

    const chatToggle = screen.getByRole('button', { name: 'Hide chat panel' })
    const stripToggle = screen.getByRole('button', { name: 'Show slide thumbnails' })

    expect(chatToggle).toHaveAttribute('aria-pressed', 'true')
    expect(chatToggle).toHaveAttribute('aria-expanded', 'true')
    expect(chatToggle).toHaveAttribute('aria-controls', 'ark-chat-panel')

    expect(stripToggle).toHaveAttribute('aria-pressed', 'false')
    expect(stripToggle).toHaveAttribute('aria-expanded', 'false')
    expect(stripToggle).toHaveAttribute('aria-controls', 'ark-slide-strip')
  })

  it('supports keyboard activation for titlebar icon buttons', async () => {
    const user = userEvent.setup()
    const onToggleChat = vi.fn()
    renderTitleBar({ onToggleChat })

    const chatToggle = screen.getByRole('button', { name: 'Show chat panel' })
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
    renderTitleBar({ onDownload, showSanitizedDownload: true })

    await user.click(screen.getByRole('button', { name: 'Download HTML' }))
    await user.click(screen.getByText('Original HTML'))
    await user.click(screen.getByRole('button', { name: 'Download HTML' }))
    await user.click(screen.getByText('Sanitized HTML'))

    expect(onDownload).toHaveBeenNthCalledWith(1, 'original')
    expect(onDownload).toHaveBeenNthCalledWith(2, 'sanitized')
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
