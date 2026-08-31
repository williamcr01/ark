import { type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import {
  createEditorTransformCommitMessage,
  createEditorTransformPreviewMessage,
  type EditorNormalizedRect,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
} from '@ark/editor-runtime'

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
    geometryEditable?: boolean
    editableKind: string | null
    textPreview: string | null
  } | null,
  selections: [] as Array<{
    elementId: string
    slideIndex: number
    slideId: string | null
    tagName: string
    locked: boolean
    managed: boolean
    editableKind: string | null
    textPreview: string | null
  }>,
  geometry: null as EditorNormalizedRect | null,
  slideBounds: null as EditorNormalizedRect | null,
  selectionGeometries: {} as Record<
    string,
    { geometry: EditorNormalizedRect; slideBounds: EditorNormalizedRect | null }
  >,
  selectionZIndex: null,
  hover: null as {
    elementId: string | null
    slideIndex: number
    surface?: 'light' | 'dark'
  } | null,
  hoverGeometry: null as EditorNormalizedRect | null,
  hoverSlideBounds: null as EditorNormalizedRect | null,
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
  lastShortcutRequest: null as { action: 'undo' | 'redo' | 'duplicate'; sequence: number } | null,
  transformPreview: null as EditorTransformPreviewMessage | null,
  transformCommit: null as EditorTransformCommitMessage | null,
  transformCancelSequence: 0,
  setTransformPreviewListener: vi.fn(),
  enableEditor: vi.fn(),
  configureEditor: vi.fn(),
  disableEditor: vi.fn(),
  selectElement: vi.fn(),
  clearSelection: vi.fn(() => true),
  requestGeometry: vi.fn(),
  startTextEdit: vi.fn(),
  cancelTextEdit: vi.fn(),
  setTool: vi.fn(),
}))

const previewFrameMock = vi.hoisted(() => ({
  iframeKey: 'test-preview',
  handshake: 'test-handshake-value',
  isLoading: false,
  isStale: false,
}))

const useDeckPreviewFrameMock = vi.hoisted(() =>
  vi.fn((_html: string, _enabled: boolean, _reloadRevision = 0) => ({
    iframeKey: previewFrameMock.iframeKey,
    iframeSrc: 'http://localhost:5174/preview/test',
    sandboxOrigin: null,
    isLoading: previewFrameMock.isLoading,
    isStale: previewFrameMock.isStale,
    error: null,
    usesSandboxHost: false,
    handshake: previewFrameMock.handshake,
  })),
)

const reportRuntimeErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'err-1' }))
const deckSlideNavigationOptionsMock = vi.hoisted(() => vi.fn())
const goToSlideMock = vi.hoisted(() => vi.fn())
const useDeckThumbnailsMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: null,
    thumbnailUrls: null,
    error: null,
    isLoading: false,
  })),
)
const editorBridgeOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useDeckEditorBridge', () => ({
  useDeckEditorBridge: (...args: unknown[]) => {
    editorBridgeOptionsMock(...args)
    return editorBridgeMock
  },
}))

vi.mock('@/hooks/useDeckSlideNavigation', () => ({
  useDeckSlideNavigation: (...args: unknown[]) => {
    deckSlideNavigationOptionsMock(args[4])
    return {
      activeSlideIndex: 0,
      goToSlide: goToSlideMock,
    }
  },
}))

vi.mock('@/hooks/useDeckPreviewFrame', () => ({
  useDeckPreviewFrame: useDeckPreviewFrameMock,
}))

vi.mock('@/hooks/useDeckThumbnails', () => ({
  useDeckThumbnails: useDeckThumbnailsMock,
}))

vi.mock('@/lib/api/runtime-error-api', () => ({
  reportRuntimeError: reportRuntimeErrorMock,
}))

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => [vi.fn(), { width: 1280, height: 720 }],
}))

const plainDeckProps = {
  html: plainCssDeck,
  state: {
    canRedo: false,
    canUndo: false,
    editorBridgeEnabled: false,
    isDeckLoading: false,
    isGenerating: false,
    isPreviewUpdating: false,
    isStripOpen: false,
    isTextEditSaving: false,
  },
  layout: 'desktop' as const,
  deckAnalysis: analyzeDeckInBrowser(plainCssDeck),
}

describe('DeckPreview script divergence UI', () => {
  beforeEach(() => {
    editorBridgeMock.editorReady = false
    editorBridgeMock.selection = null
    editorBridgeMock.selections = []
    editorBridgeMock.geometry = null
    editorBridgeMock.slideBounds = null
    editorBridgeMock.selectionGeometries = {}
    editorBridgeMock.selectionZIndex = null
    editorBridgeMock.hover = null
    editorBridgeMock.hoverGeometry = null
    editorBridgeMock.hoverSlideBounds = null
    editorBridgeMock.editorError = null
    editorBridgeMock.textEditActive = false
    editorBridgeMock.lastTextCommit = null
    editorBridgeMock.lastInsertRequest = null
    editorBridgeMock.lastDeleteRequest = null
    editorBridgeMock.lastShortcutRequest = null
    editorBridgeMock.transformPreview = null
    editorBridgeMock.transformCommit = null
    editorBridgeMock.transformCancelSequence = 0
    editorBridgeMock.enableEditor.mockClear()
    editorBridgeMock.configureEditor.mockClear()
    editorBridgeMock.disableEditor.mockClear()
    editorBridgeMock.selectElement.mockClear()
    editorBridgeMock.clearSelection.mockClear()
    editorBridgeMock.requestGeometry.mockClear()
    editorBridgeMock.startTextEdit.mockClear()
    editorBridgeMock.cancelTextEdit.mockClear()
    editorBridgeMock.setTool.mockClear()
    goToSlideMock.mockClear()
    previewFrameMock.iframeKey = 'test-preview'
    previewFrameMock.handshake = 'test-handshake-value'
    previewFrameMock.isLoading = false
    previewFrameMock.isStale = false
    useDeckPreviewFrameMock.mockClear()
    useDeckThumbnailsMock.mockClear()
    reportRuntimeErrorMock.mockClear()
    deckSlideNavigationOptionsMock.mockClear()
    editorBridgeOptionsMock.mockClear()
  })

  it('shows an edit-text action for unlocked text selections', async () => {
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

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
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

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    await user.click(screen.getByRole('button', { name: 'Edit selected text' }))

    expect(editorBridgeMock.startTextEdit).toHaveBeenCalledWith('transient-el-0-0', 0)
  })

  it('starts text editing when Enter is pressed with a text selection', async () => {
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

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(editorBridgeMock.startTextEdit).toHaveBeenCalledWith('transient-el-0-0', 0)
  })

  it('cancels text editing when Escape is pressed', async () => {
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

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(editorBridgeMock.cancelTextEdit).toHaveBeenCalled()
  })

  it('resets the active tool when Escape is pressed outside text editing', async () => {
    const user = userEvent.setup()

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    await user.click(screen.getByRole('button', { name: 'Text box' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(editorBridgeMock.setTool).toHaveBeenCalledWith('select')
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears editor selection when Escape is pressed with the select tool', async () => {
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

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(editorBridgeMock.clearSelection).toHaveBeenCalled()
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
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
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

  it('keeps the iframe source stable after a source-backed text edit', async () => {
    const beforeHtml =
      '<!doctype html><html><body><section class="slide"><h1 data-ark-id="title">Before</h1></section></body></html>'
    const afterHtml = beforeHtml.replace('>Before<', '>After<')
    const onCommitTextEdit = vi.fn().mockResolvedValue({
      deck: { html: afterHtml },
      patch: {
        appliedCount: 1,
        changedSlideIndexes: [0],
        changedElementIds: ['title'],
        summary: 'Edited text',
      },
    })

    editorBridgeMock.lastTextCommit = {
      elementId: 'title',
      slideIndex: 0,
      slideId: null,
      text: 'After',
      originalText: 'Before',
    }

    const props = {
      ...plainDeckProps,
      html: beforeHtml,
      deckId: 'deck-1',
      deckAnalysis: analyzeDeckInBrowser(beforeHtml),
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      onCommitTextEdit,
    }
    const { rerender } = renderDeckPreview(props)

    await act(async () => {
      await Promise.resolve()
    })

    editorBridgeMock.lastTextCommit = null
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} html={afterHtml} deckAnalysis={analyzeDeckInBrowser(afterHtml)} />
      </TooltipProvider>,
    )

    expect(useDeckPreviewFrameMock).toHaveBeenLastCalledWith(beforeHtml, true, 0, 'deck-1')
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
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
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
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
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
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
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
        <DeckPreview
          {...plainDeckProps}
          state={{ ...plainDeckProps.state, editorBridgeEnabled: true }}
          onCommitTextEdit={onCommitTextEdit}
        />
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
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
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

  it('does not leave a stale hover outline behind the selected element while dragging', () => {
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
    editorBridgeMock.geometry = { x: 0.4, y: 0.35, width: 0.3, height: 0.1 }
    editorBridgeMock.hover = { elementId: 'ark-el-box', slideIndex: 0 }
    editorBridgeMock.hoverGeometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    const { container } = renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })

    expect(
      container.querySelector(
        '.pointer-events-none.absolute.left-0.top-0.rounded-sm.border:not(.border-2)',
      ),
    ).not.toBeInTheDocument()
  })

  it('draws overlay chrome for every selected element', () => {
    editorBridgeMock.selection = {
      elementId: 'ark-el-box',
      slideIndex: 0,
      slideId: 'slide-1',
      tagName: 'div',
      locked: false,
      managed: true,
      editableKind: 'text-box',
      textPreview: 'Primary',
    }
    editorBridgeMock.selections = [
      {
        elementId: 'ark-el-box',
        slideIndex: 0,
        slideId: 'slide-1',
        tagName: 'div',
        locked: false,
        managed: true,
        editableKind: 'text-box',
        textPreview: 'Primary',
      },
      {
        elementId: 'ark-el-copy',
        slideIndex: 0,
        slideId: 'slide-1',
        tagName: 'p',
        locked: false,
        managed: true,
        editableKind: null,
        textPreview: 'Copy',
      },
    ]
    editorBridgeMock.geometry = { x: 0.4, y: 0.35, width: 0.3, height: 0.1 }
    editorBridgeMock.selectionGeometries = {
      'ark-el-box': {
        geometry: { x: 0.4, y: 0.35, width: 0.3, height: 0.1 },
        slideBounds: null,
      },
      'ark-el-copy': {
        geometry: { x: 0.1, y: 0.6, width: 0.2, height: 0.08 },
        slideBounds: null,
      },
    }

    const { container } = renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })

    expect(container.querySelector('[data-editor-primary-selection]')).toBeInTheDocument()
    expect(container.querySelector('[data-editor-companion="ark-el-copy"]')).toBeInTheDocument()
  })

  it('drops the drag baseline after a runtime transform cancellation', () => {
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
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      onPatchEditorOperations,
    }
    const { rerender } = renderDeckPreview(props)
    const renderProps = () =>
      rerender(
        <TooltipProvider>
          <DeckPreview {...props} />
        </TooltipProvider>,
      )

    editorBridgeMock.transformPreview = createEditorTransformPreviewMessage(
      'ark-el-box',
      0,
      endGeometry,
    )
    renderProps()

    editorBridgeMock.transformPreview = null
    editorBridgeMock.transformCancelSequence = 1
    renderProps()

    editorBridgeMock.transformCommit = createEditorTransformCommitMessage(
      'ark-el-box',
      0,
      endGeometry,
    )
    renderProps()

    expect(onPatchEditorOperations.mock.calls[0]?.[0]).toEqual([
      {
        op: 'move_element',
        elementId: 'ark-el-box',
        slideIndex: 0,
        slideId: 'slide-1',
        x: endGeometry.x,
        y: endGeometry.y,
      },
      {
        op: 'resize_element',
        elementId: 'ark-el-box',
        slideIndex: 0,
        slideId: 'slide-1',
        width: endGeometry.width,
        height: endGeometry.height,
      },
    ])
  })

  it('triggers undo and redo from the toolbar history buttons', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo: true, canRedo: true },
      onUndo,
      onRedo,
    })
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await user.click(screen.getByRole('button', { name: 'Redo' }))

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('undoes and redoes with keyboard shortcuts in edit mode', async () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo: true, canRedo: true },
      onUndo,
      onRedo,
    })

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(onRedo).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(onRedo).toHaveBeenCalledTimes(2)
  })

  it('handles shortcuts forwarded by the editor runtime', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)
    editorBridgeMock.selection = {
      elementId: 'ark-el-box',
      slideIndex: 0,
      slideId: 'slide-1',
      tagName: 'div',
      locked: false,
      managed: false,
      editableKind: 'text-box',
      textPreview: 'Text',
    }
    editorBridgeMock.lastShortcutRequest = { action: 'undo', sequence: 1 }
    const props = {
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo: true, canRedo: true },
      onUndo,
      onRedo,
      onPatchEditorOperations,
    }
    const { rerender } = renderDeckPreview(props)

    expect(onUndo).toHaveBeenCalledTimes(1)

    editorBridgeMock.lastShortcutRequest = { action: 'redo', sequence: 2 }
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )
    expect(onRedo).toHaveBeenCalledTimes(1)

    editorBridgeMock.lastShortcutRequest = { action: 'duplicate', sequence: 3 }
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )
    expect(onPatchEditorOperations).toHaveBeenCalledWith(
      [
        {
          op: 'duplicate_element',
          elementId: 'ark-el-box',
          slideIndex: 0,
          slideId: 'slide-1',
        },
      ],
      0,
      'Duplicated element in preview',
    )
  })

  it.each(['undo', 'redo'] as const)(
    'drops forwarded %s while a transform commit is pending',
    (action) => {
      const onUndo = vi.fn()
      const onRedo = vi.fn()
      const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)
      editorBridgeMock.selection = {
        elementId: 'ark-el-box',
        slideIndex: 0,
        slideId: 'slide-1',
        tagName: 'div',
        locked: false,
        managed: true,
        editableKind: 'text-box',
        textPreview: 'Text',
      }
      editorBridgeMock.lastShortcutRequest = { action, sequence: 1 }
      editorBridgeMock.transformCommit = createEditorTransformCommitMessage('ark-el-box', 0, {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.1,
      })

      renderDeckPreview({
        ...plainDeckProps,
        state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo: true, canRedo: true },
        onUndo,
        onRedo,
        onPatchEditorOperations,
      })

      expect(onUndo).not.toHaveBeenCalled()
      expect(onRedo).not.toHaveBeenCalled()
      expect(onPatchEditorOperations.mock.calls.flatMap(([operations]) => operations)).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ op: 'duplicate_element' })]),
      )
    },
  )

  it('serializes duplicate after an adopted transform and uses its stable id', async () => {
    let resolveTransform!: (result: { patch: { changedElementIds: string[] } }) => void
    const transformPromise = new Promise<{ patch: { changedElementIds: string[] } }>((resolve) => {
      resolveTransform = resolve
    })
    const onPatchEditorOperations = vi
      .fn()
      .mockImplementationOnce(() => transformPromise)
      .mockResolvedValueOnce(undefined)
    editorBridgeMock.selection = {
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      slideId: 'slide-1',
      tagName: 'h1',
      locked: false,
      managed: false,
      editableKind: 'text',
      textPreview: 'Title',
    }
    editorBridgeMock.lastShortcutRequest = { action: 'duplicate', sequence: 1 }
    editorBridgeMock.transformCommit = createEditorTransformCommitMessage(
      'transient-el-0-0',
      0,
      { x: 0.2, y: 0.2, width: 0.3, height: 0.1 },
      undefined,
      undefined,
      true,
    )

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      onPatchEditorOperations,
    })

    expect(onPatchEditorOperations).toHaveBeenCalledTimes(1)
    expect(onPatchEditorOperations.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        op: 'move_element',
        elementId: 'transient-el-0-0',
      }),
    ])

    await act(async () => {
      resolveTransform({ patch: { changedElementIds: ['ark-el-stable'] } })
      await transformPromise
    })

    expect(onPatchEditorOperations).toHaveBeenCalledTimes(2)
    expect(onPatchEditorOperations.mock.calls[1]).toEqual([
      [
        {
          op: 'duplicate_element',
          elementId: 'ark-el-stable',
          slideIndex: 0,
          slideId: 'slide-1',
        },
      ],
      0,
      'Duplicated element in preview',
    ])
  })

  it.each([false, true])(
    'cancels a transform without undo or persistence when canUndo is %s',
    (canUndo) => {
      const onUndo = vi.fn()
      const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)
      editorBridgeMock.transformPreview = createEditorTransformPreviewMessage('ark-el-box', 0, {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.1,
      })
      const props = {
        ...plainDeckProps,
        state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo },
        onUndo,
        onPatchEditorOperations,
      }
      const { rerender } = renderDeckPreview(props)

      editorBridgeMock.transformPreview = null
      editorBridgeMock.transformCancelSequence = 1
      rerender(
        <TooltipProvider>
          <DeckPreview {...props} />
        </TooltipProvider>,
      )

      expect(onUndo).not.toHaveBeenCalled()
      expect(onPatchEditorOperations).not.toHaveBeenCalled()
    },
  )

  it('does not hijack undo shortcut while editing text', async () => {
    const onUndo = vi.fn()

    editorBridgeMock.textEditActive = true

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo: true },
      onUndo,
    })

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
  })
})

it('does not undo with keyboard when nothing is undoable', async () => {
  const onUndo = vi.fn()

  renderDeckPreview({
    ...plainDeckProps,
    state: { ...plainDeckProps.state, editorBridgeEnabled: true, canUndo: false },
    onUndo,
  })

  fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

  expect(onUndo).not.toHaveBeenCalled()
})

it('does not undo with keyboard while a patch is saving', async () => {
  const onUndo = vi.fn()

  renderDeckPreview({
    ...plainDeckProps,
    state: {
      ...plainDeckProps.state,
      editorBridgeEnabled: true,
      canUndo: true,
      isTextEditSaving: true,
    },
    onUndo,
  })

  fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

  expect(onUndo).not.toHaveBeenCalled()
})
