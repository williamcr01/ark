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
  selection: null as {
    elementId: string
    slideIndex: number
    slideId: string | null
    tagName: string
    locked: boolean
    textPreview: string | null
  } | null,
  geometry: null,
  editorError: null,
  lastTextCommit: null as { elementId: string; slideIndex: number; text: string } | null,
  enableEditor: vi.fn(),
  disableEditor: vi.fn(),
  requestGeometry: vi.fn(),
  startTextEdit: vi.fn(),
  cancelTextEdit: vi.fn(),
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
    editorBridgeMock.geometry = null
    editorBridgeMock.editorError = null
    editorBridgeMock.lastTextCommit = null
    editorBridgeMock.enableEditor.mockClear()
    editorBridgeMock.disableEditor.mockClear()
    editorBridgeMock.requestGeometry.mockClear()
    editorBridgeMock.startTextEdit.mockClear()
    editorBridgeMock.cancelTextEdit.mockClear()
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

  it('shows an edit-text action for unlocked text selections', async () => {
    const user = userEvent.setup()

    editorBridgeMock.selection = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: false,
      textPreview: 'Quarterly planning',
    }

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

    expect(screen.getByRole('button', { name: 'Edit selected text' })).toBeInTheDocument()
  })

  it('starts text editing from the toolbar action', async () => {
    const user = userEvent.setup()

    editorBridgeMock.selection = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: false,
      textPreview: 'Quarterly planning',
    }

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
    await user.click(screen.getByRole('button', { name: 'Edit selected text' }))

    expect(editorBridgeMock.startTextEdit).toHaveBeenCalledWith('transient-el-0-0', 0)
  })

  it('starts text editing when Enter is pressed with a text selection', async () => {
    const user = userEvent.setup()

    editorBridgeMock.selection = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      tagName: 'p',
      locked: false,
      textPreview: 'Body copy',
    }

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

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(editorBridgeMock.startTextEdit).toHaveBeenCalledWith('transient-el-0-0', 0)
  })

  it('cancels text editing when Escape is pressed', async () => {
    const user = userEvent.setup()

    editorBridgeMock.selection = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: false,
      textPreview: 'Quarterly planning',
    }

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
    await user.click(screen.getByRole('button', { name: 'Edit selected text' }))
    await user.keyboard('{Escape}')

    expect(editorBridgeMock.cancelTextEdit).toHaveBeenCalled()
  })

  it('commits text edits through the patch callback', async () => {
    const onCommitTextEdit = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.selection = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: false,
      textPreview: 'Quarterly planning',
    }
    editorBridgeMock.lastTextCommit = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      text: 'Updated planning',
    }

    render(
      <DeckPreview
        editorBridgeEnabled
        html={plainCssDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        onCommitTextEdit={onCommitTextEdit}
        parsedDeck={parseDeckSlides(plainCssDeck)}
      />,
    )

    expect(onCommitTextEdit).toHaveBeenCalledWith({
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      text: 'Updated planning',
      originalText: 'Quarterly planning',
    })
  })

  it('shows locked messaging for locked selections', async () => {
    const user = userEvent.setup()

    editorBridgeMock.selection = {
      elementId: 'locked-el',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: true,
      textPreview: 'Runtime title',
    }

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

    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit selected text' })).not.toBeInTheDocument()
  })
})
