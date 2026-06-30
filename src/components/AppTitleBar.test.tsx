import { createRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { AppTitleBar } from './AppTitleBar'

function renderTitleBar(overrides: Partial<ComponentProps<typeof AppTitleBar>> = {}) {
  const fileInputRef = createRef<HTMLInputElement>()

  render(
    <TooltipProvider>
      <AppTitleBar
        deckSaveStatus="saved"
        fileInputRef={fileInputRef}
        hasDeck
        hasSlides
        isChatOpen={false}
        isGenerating={false}
        isStripOpen={false}
        onDownload={vi.fn()}
        onHtmlUpload={vi.fn()}
        onReset={vi.fn()}
        onToggleChat={vi.fn()}
        onToggleStrip={vi.fn()}
        onUploadClick={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  )

  return { fileInputRef }
}

describe('AppTitleBar accessibility', () => {
  it('does not expose aria-pressed on non-toggle action buttons', () => {
    renderTitleBar()

    expect(screen.getByRole('button', { name: 'Start over' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Download HTML' })).not.toHaveAttribute(
      'aria-pressed',
    )
    expect(screen.getByRole('button', { name: 'Upload HTML' })).not.toHaveAttribute('aria-pressed')
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
})
