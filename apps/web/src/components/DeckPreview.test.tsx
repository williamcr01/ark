import { type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'
import { parseDeckSlides } from '@/lib/deck-slides'
import {
  createEditorTransformCommitMessage,
  createEditorTransformPreviewMessage,
  type EditorNormalizedRect,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
} from '@ark/deck-core/deck-editor-bridge.ts'

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
    managed: boolean
    editableKind: string | null
    textPreview: string | null
  } | null,
  geometry: null as EditorNormalizedRect | null,
  selectionZIndex: null,
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
  lastInsertRequest: null,
  lastDeleteRequest: null,
  transformPreview: null as EditorTransformPreviewMessage | null,
  transformCommit: null as EditorTransformCommitMessage | null,
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
    editorBridgeMock.selectionZIndex = null
    editorBridgeMock.hover = null
    editorBridgeMock.hoverGeometry = null
    editorBridgeMock.editorError = null
    editorBridgeMock.textEditActive = false
    editorBridgeMock.lastTextCommit = null
    editorBridgeMock.lastInsertRequest = null
    editorBridgeMock.lastDeleteRequest = null
    editorBridgeMock.transformPreview = null
    editorBridgeMock.transformCommit = null
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
      managed: false,
      editableKind: null,
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
      managed: false,
      editableKind: null,
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
      managed: false,
      editableKind: null,
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
      managed: false,
      editableKind: null,
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
      managed: false,
      editableKind: null,
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

  it('forwards forged text commits to onCommitTextEdit without client-side element validation', () => {
    const onCommitTextEdit = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.lastTextCommit = {
      elementId: 'ark-el-locked-victim',
      slideIndex: 0,
      slideId: null,
      text: 'Injected copy',
      originalText: 'Victim',
    }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onCommitTextEdit,
    })

    expect(onCommitTextEdit).toHaveBeenCalledWith({
      elementId: 'ark-el-locked-victim',
      slideIndex: 0,
      slideId: null,
      text: 'Injected copy',
      originalText: 'Victim',
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

  it('persists drag transforms by diffing against the pre-drag geometry', async () => {
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)
    const startGeometry: EditorNormalizedRect = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }
    const endGeometry: EditorNormalizedRect = { x: 0.4, y: 0.35, width: 0.3, height: 0.1 }

    editorBridgeMock.selection = {
      elementId: 'ark-el-box',
      slideIndex: 0,
      slideId: 'slide-1',
      tagName: 'div',
      locked: false,
      managed: true,
      editableKind: 'text-box',
      textPreview: 'New text',
    }
    editorBridgeMock.geometry = startGeometry

    const props = {
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    }

    const { rerender } = renderDeckPreview(props)

    const renderProps = () =>
      rerender(
        <TooltipProvider>
          <DeckPreview {...props} />
        </TooltipProvider>,
      )

    // Drag begins: the runtime streams a transform preview frame.
    editorBridgeMock.transformPreview = createEditorTransformPreviewMessage(
      'ark-el-box',
      0,
      endGeometry,
    )
    renderProps()

    // Preview frames also push live geometry updates that would otherwise poison
    // the baseline used to diff the commit.
    editorBridgeMock.geometry = endGeometry
    renderProps()

    // Pointer up: the runtime commits at the final rect.
    editorBridgeMock.transformPreview = null
    editorBridgeMock.transformCommit = createEditorTransformCommitMessage(
      'ark-el-box',
      0,
      endGeometry,
    )
    renderProps()

    expect(onPatchEditorOperations).toHaveBeenCalledTimes(1)
    const [operations] = onPatchEditorOperations.mock.calls[0]!
    expect(operations).toEqual([
      {
        op: 'move_element',
        elementId: 'ark-el-box',
        slideIndex: 0,
        slideId: 'slide-1',
        x: endGeometry.x,
        y: endGeometry.y,
      },
    ])
  })

  it('triggers undo and redo from the toolbar history buttons', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: true,
      canRedo: true,
      onUndo,
      onRedo,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await user.click(screen.getByRole('button', { name: 'Redo' }))

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('undoes and redoes with keyboard shortcuts in edit mode', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: true,
      canRedo: true,
      onUndo,
      onRedo,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(onRedo).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(onRedo).toHaveBeenCalledTimes(2)
  })

  it('does not hijack undo shortcut while editing text', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()

    editorBridgeMock.textEditActive = true

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: true,
      onUndo,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not undo with keyboard when nothing is undoable', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: false,
      onUndo,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not undo with keyboard while a patch is saving', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: true,
      isTextEditSaving: true,
      onUndo,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
  })

  it('shows locked messaging for locked selections', async () => {
    const user = userEvent.setup()

    editorBridgeMock.selection = {
      elementId: 'locked-el',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: true,
      managed: false,
      editableKind: null,
      textPreview: 'Runtime title',
    }

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit selected text' })).not.toBeInTheDocument()
  })
})
