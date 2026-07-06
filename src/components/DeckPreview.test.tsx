import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@/test/fixtures/reveal-registry-deck.html?raw'
import { parseDeckSlides } from '@/lib/deck-slides'

import { DeckPreview } from './DeckPreview'

const editorBridgeMock = vi.hoisted(() => ({
  editorReady: false,
  selection: null,
  editorError: null,
  enableEditor: vi.fn(),
  disableEditor: vi.fn(),
  requestGeometry: vi.fn(),
}))

vi.mock('@/hooks/useDeckEditorBridge', () => ({
  useDeckEditorBridge: () => editorBridgeMock,
}))

vi.mock('@/hooks/useDeckSlideNavigation', () => ({
  useDeckSlideNavigation: () => ({
    activeSlideIndex: 0,
    goToSlide: vi.fn(),
  }),
}))

vi.mock('@/hooks/useDeckPreviewFrame', () => ({
  useDeckPreviewFrame: () => ({
    iframeKey: 'test-preview',
    iframeSrcDoc: '<html></html>',
    sandboxOrigin: null,
    isLoading: false,
    error: null,
    usesSandboxHost: false,
  }),
}))

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => [vi.fn(), { width: 1600, height: 900 }],
}))

describe('DeckPreview script divergence UI', () => {
  beforeEach(() => {
    editorBridgeMock.editorReady = false
    editorBridgeMock.selection = null
    editorBridgeMock.editorError = null
    editorBridgeMock.enableEditor.mockClear()
    editorBridgeMock.disableEditor.mockClear()
    editorBridgeMock.requestGeometry.mockClear()
  })

  it('shows static preview messaging for uploaded scripted decks', () => {
    render(
      <DeckPreview
        html={hostileScriptsDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(hostileScriptsDeck)}
      />,
    )

    expect(screen.getAllByText('Static preview').length).toBeGreaterThan(0)
    expect(screen.getByText(/Scripts and inline handlers were removed for preview/i)).toBeVisible()
  })

  it('does not show static preview messaging for plain CSS decks', () => {
    render(
      <DeckPreview
        html={plainCssDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(plainCssDeck)}
      />,
    )

    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })

  it('shows reveal runtime messaging for approved reveal registry decks', () => {
    render(
      <DeckPreview
        html={revealRegistryDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(revealRegistryDeck)}
      />,
    )

    expect(screen.getAllByText('Reveal runtime').length).toBeGreaterThan(0)
    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })

  it('can opt into editor bridge controls without enabling edit mode by default', () => {
    render(
      <DeckPreview
        editorBridgeEnabled
        html={plainCssDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(plainCssDeck)}
      />,
    )

    expect(screen.getByRole('button', { name: 'Enable edit mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable edit mode' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('toggles edit mode from the preview chrome', async () => {
    const user = userEvent.setup()

    render(
      <DeckPreview
        editorBridgeEnabled
        html={plainCssDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(plainCssDeck)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Enable edit mode' }))

    expect(screen.getByRole('button', { name: 'Disable edit mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('enables the editor bridge when the edit-mode iframe loads', async () => {
    const user = userEvent.setup()

    render(
      <DeckPreview
        editorBridgeEnabled
        html={plainCssDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(plainCssDeck)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Enable edit mode' }))
    fireEvent.load(screen.getByTitle('Generated Ark presentation preview'))

    expect(editorBridgeMock.enableEditor).toHaveBeenCalledWith(0)
  })
})
