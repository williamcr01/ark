import { type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@/test/fixtures/reveal-registry-deck.html?raw'
import { parseDeckSlides } from '@/lib/deck-slides'

import { DeckPreview } from './DeckPreview'

function renderDeckPreview(props: ComponentProps<typeof DeckPreview>) {
  return render(
    <TooltipProvider>
      <DeckPreview {...props} />
    </TooltipProvider>,
  )
}

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
  hover: null,
  hoverGeometry: null,
  editorError: null,
  textEditActive: false,
  lastTextCommit: null as {
    elementId: string
    slideIndex: number
    slideId: string | null
    text: string
    originalText: string
  } | null,
  enableEditor: vi.fn(),
  disableEditor: vi.fn(),
  requestGeometry: vi.fn(),
  startTextEdit: vi.fn(),
  cancelTextEdit: vi.fn(),
  setTool: vi.fn(),
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

const plainDeckProps = {
  html: plainCssDeck,
  isGenerating: false,
  isStripOpen: false,
  layout: 'desktop' as const,
  parsedDeck: parseDeckSlides(plainCssDeck),
}

describe('DeckPreview script divergence UI', () => {
  beforeEach(() => {
    editorBridgeMock.editorReady = false
    editorBridgeMock.selection = null
    editorBridgeMock.geometry = null
    editorBridgeMock.hover = null
    editorBridgeMock.hoverGeometry = null
    editorBridgeMock.editorError = null
    editorBridgeMock.textEditActive = false
    editorBridgeMock.lastTextCommit = null
    editorBridgeMock.enableEditor.mockClear()
    editorBridgeMock.disableEditor.mockClear()
    editorBridgeMock.requestGeometry.mockClear()
    editorBridgeMock.startTextEdit.mockClear()
    editorBridgeMock.cancelTextEdit.mockClear()
    editorBridgeMock.setTool.mockClear()
  })

  it('shows static preview messaging for uploaded scripted decks', () => {
    renderDeckPreview({
      html: hostileScriptsDeck,
      isGenerating: false,
      isStripOpen: false,
      layout: 'desktop',
      parsedDeck: parseDeckSlides(hostileScriptsDeck),
    })

    expect(screen.getAllByText('Static preview').length).toBeGreaterThan(0)
    expect(screen.getByText(/Scripts and inline handlers were removed for preview/i)).toBeVisible()
  })

  it('does not show static preview messaging for plain CSS decks', () => {
    renderDeckPreview(plainDeckProps)

    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })

  it('shows reveal runtime messaging for approved reveal registry decks', () => {
    renderDeckPreview({
      html: revealRegistryDeck,
      isGenerating: false,
      isStripOpen: false,
      layout: 'desktop',
      parsedDeck: parseDeckSlides(revealRegistryDeck),
    })

    expect(screen.getAllByText('Reveal runtime').length).toBeGreaterThan(0)
    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })

  it('can opt into editor bridge controls without enabling edit mode by default', () => {
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    expect(screen.getByRole('button', { name: 'Edit mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit mode' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
  })

  it('toggles edit mode from the preview chrome', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(screen.getByRole('button', { name: 'Edit mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
  })

  it('returns to preview mode without changing the active slide', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    await user.click(screen.getByRole('button', { name: 'Preview mode' }))

    expect(screen.getByRole('button', { name: 'Preview mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
    expect(screen.getByText('Slide 1 of 3')).toBeInTheDocument()
  })

  it('exits edit mode when generation starts', async () => {
    const user = userEvent.setup()

    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} editorBridgeEnabled isGenerating />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
    expect(editorBridgeMock.disableEditor).toHaveBeenCalled()
  })

  it('enables the editor bridge when the edit-mode iframe loads', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    fireEvent.load(screen.getByTitle('Generated Ark presentation preview'))

    expect(editorBridgeMock.enableEditor).toHaveBeenCalledWith(0, 'select')
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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

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
    editorBridgeMock.textEditActive = true

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(editorBridgeMock.cancelTextEdit).toHaveBeenCalled()
  })

  it('resets the active tool when Escape is pressed outside text editing', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    await user.click(screen.getByRole('button', { name: 'Text box' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(editorBridgeMock.setTool).toHaveBeenCalledWith('select')
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
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
      slideId: null,
      text: 'Updated planning',
      originalText: 'Quarterly planning',
    }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onCommitTextEdit,
    })

    expect(onCommitTextEdit).toHaveBeenCalledWith({
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      text: 'Updated planning',
      originalText: 'Quarterly planning',
    })
  })

  it('skips patch commits when text did not change', () => {
    const onCommitTextEdit = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.lastTextCommit = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      text: 'Quarterly planning',
      originalText: 'Quarterly planning',
    }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onCommitTextEdit,
    })

    expect(onCommitTextEdit).not.toHaveBeenCalled()
  })

  it('commits repeated text edits that return to a prior value after an intervening change', () => {
    const onCommitTextEdit = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.lastTextCommit = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      text: 'Quarterly planning',
      originalText: 'Updated planning',
    }

    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onCommitTextEdit,
    })

    expect(onCommitTextEdit).toHaveBeenCalledTimes(1)

    editorBridgeMock.lastTextCommit = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: null,
      text: 'Updated planning',
      originalText: 'Quarterly planning',
    }

    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} editorBridgeEnabled onCommitTextEdit={onCommitTextEdit} />
      </TooltipProvider>,
    )

    expect(onCommitTextEdit).toHaveBeenCalledTimes(2)
    expect(onCommitTextEdit).toHaveBeenLastCalledWith({
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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit selected text' })).not.toBeInTheDocument()
  })
})
