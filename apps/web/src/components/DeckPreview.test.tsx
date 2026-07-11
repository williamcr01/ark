import { type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
  selectElement: vi.fn(),
  clearSelection: vi.fn(),
  requestGeometry: vi.fn(),
  startTextEdit: vi.fn(),
  cancelTextEdit: vi.fn(),
  setTool: vi.fn(),
}))

const previewFrameMock = vi.hoisted(() => ({
  iframeKey: 'test-preview',
  handshake: 'test-handshake-value',
}))

const useDeckPreviewFrameMock = vi.hoisted(() =>
  vi.fn((_html: string, _enabled: boolean) => ({
    iframeKey: previewFrameMock.iframeKey,
    iframeSrcDoc: '<html></html>',
    sandboxOrigin: null,
    isLoading: false,
    error: null,
    usesSandboxHost: false,
    handshake: previewFrameMock.handshake,
  })),
)

const reportRuntimeErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'err-1' }))

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
  useDeckPreviewFrame: useDeckPreviewFrameMock,
}))

vi.mock('@/lib/runtime-error-api', () => ({
  reportRuntimeError: reportRuntimeErrorMock,
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
    editorBridgeMock.selectElement.mockClear()
    editorBridgeMock.clearSelection.mockClear()
    editorBridgeMock.requestGeometry.mockClear()
    editorBridgeMock.startTextEdit.mockClear()
    editorBridgeMock.cancelTextEdit.mockClear()
    editorBridgeMock.setTool.mockClear()
    previewFrameMock.iframeKey = 'test-preview'
    previewFrameMock.handshake = 'test-handshake-value'
    useDeckPreviewFrameMock.mockClear()
    reportRuntimeErrorMock.mockClear()
  })

  it('tears down the preview and reports when the iframe self-navigates', async () => {
    renderDeckPreview(plainDeckProps)

    const iframe = screen.getByTitle('Generated Ark presentation preview')

    fireEvent.load(iframe)
    expect(screen.queryByText('Preview stopped')).not.toBeInTheDocument()

    fireEvent.load(iframe)

    expect(await screen.findByText('Preview stopped')).toBeVisible()
    expect(screen.getByText(/The deck attempted an unexpected navigation/i)).toBeVisible()
    expect(screen.queryByTitle('Generated Ark presentation preview')).not.toBeInTheDocument()
    expect(reportRuntimeErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'preview-navigation-guard',
        severity: 'error',
      }),
    )
  })

  it('does not post editor enable after compromise even if onLoad races', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })
    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    const iframe = screen.getByTitle('Generated Ark presentation preview')
    fireEvent.load(iframe)
    fireEvent.load(iframe)

    expect(await screen.findByText('Preview stopped')).toBeVisible()
    editorBridgeMock.enableEditor.mockClear()

    // Hostile load path must not re-enable after teardown.
    expect(editorBridgeMock.enableEditor).not.toHaveBeenCalled()
  })

  it('does not treat a shell remount (new iframe key) as hostile navigation', async () => {
    const { rerender } = renderDeckPreview(plainDeckProps)

    fireEvent.load(screen.getByTitle('Generated Ark presentation preview'))
    fireEvent.load(screen.getByTitle('Generated Ark presentation preview'))
    expect(await screen.findByText('Preview stopped')).toBeVisible()

    previewFrameMock.iframeKey = 'test-preview-reloaded'
    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} />
      </TooltipProvider>,
    )

    expect(screen.queryByText('Preview stopped')).not.toBeInTheDocument()
    expect(screen.getByTitle('Generated Ark presentation preview')).toBeInTheDocument()
    fireEvent.load(screen.getByTitle('Generated Ark presentation preview'))
    expect(screen.queryByText('Preview stopped')).not.toBeInTheDocument()
  })

  it('reuses the main preview frame when opening present mode', async () => {
    const user = userEvent.setup()
    renderDeckPreview(plainDeckProps)

    const previewIframe = screen.getByTitle('Generated Ark presentation preview')

    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(screen.queryByTitle('Ark presentation mode')).not.toBeInTheDocument()
    expect(screen.getByTitle('Generated Ark presentation preview')).toBe(previewIframe)
    expect(screen.getAllByTitle('Generated Ark presentation preview')).toHaveLength(1)
    expect(useDeckPreviewFrameMock).toHaveBeenLastCalledWith(plainCssDeck, true)
    expect(useDeckPreviewFrameMock.mock.calls.every((call) => call[1] === true)).toBe(true)
  })

  it('hides preview chrome overlays while present mode is open', async () => {
    const user = userEvent.setup()
    renderDeckPreview({
      html: hostileScriptsDeck,
      isGenerating: false,
      isStripOpen: false,
      layout: 'desktop',
      parsedDeck: parseDeckSlides(hostileScriptsDeck),
    })

    expect(screen.getByText(/Scripts and inline handlers were removed for preview/i)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(
      screen.queryByText(/Scripts and inline handlers were removed for preview/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })

  it('disables then re-enables the editor when presenting from edit mode', async () => {
    const user = userEvent.setup()
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    editorBridgeMock.editorReady = true

    editorBridgeMock.disableEditor.mockClear()
    editorBridgeMock.enableEditor.mockClear()

    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
    expect(editorBridgeMock.disableEditor).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Exit presentation' }))

    expect(screen.queryByRole('dialog', { name: 'Presentation mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(editorBridgeMock.enableEditor).toHaveBeenCalled()
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

  it('reports editor selection to the shell only while edit mode is active', async () => {
    const user = userEvent.setup()
    const onEditorSelectionChange = vi.fn()

    editorBridgeMock.selection = {
      elementId: 'ark-el-1',
      slideIndex: 0,
      slideId: 'ark-slide-1',
      tagName: 'h1',
      locked: false,
      managed: true,
      editableKind: 'text',
      textPreview: 'Headline',
    }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onEditorSelectionChange,
    })

    // Edit mode is off on mount, so the shell mirror is cleared.
    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(null)

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))
    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementId: 'ark-el-1' }),
    )

    await user.click(screen.getByRole('button', { name: 'Preview mode' }))
    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('enables the editor bridge when the edit-mode iframe loads', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'ark:deck-handshake',
            handshake: previewFrameMock.handshake,
            protocolVersion: 1,
          },
          origin: window.location.origin,
        }),
      )
    })

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

    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Edit selected text' })).not.toBeInTheDocument()
  })

  it('shows the element inspector with an empty state in desktop edit mode only', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    expect(
      screen.queryByRole('complementary', { name: 'Element inspector' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(screen.getByRole('complementary', { name: 'Element inspector' })).toBeInTheDocument()
    expect(screen.getByText(/select an element on the slide/i)).toBeInTheDocument()
  })

  it('does not render the inspector in the mobile layout', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, layout: 'mobile', editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(
      screen.queryByRole('complementary', { name: 'Element inspector' }),
    ).not.toBeInTheDocument()
  })

  it('dispatches inspector geometry edits through the patch callback', async () => {
    const user = userEvent.setup()
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)

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
    editorBridgeMock.geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    const xInput = screen.getByRole('textbox', { name: 'X (%)' })
    await user.clear(xInput)
    await user.type(xInput, '50{enter}')

    expect(onPatchEditorOperations).toHaveBeenCalledTimes(1)
    expect(onPatchEditorOperations).toHaveBeenCalledWith(
      [
        {
          op: 'move_element',
          elementId: 'ark-el-box',
          slideIndex: 0,
          slideId: 'slide-1',
          x: 0.5,
          y: 0.1,
        },
      ],
      0,
      'Moved element',
    )
  })

  it('restores the selection after the preview reloads with patched HTML', async () => {
    const user = userEvent.setup()
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.editorReady = true
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
    editorBridgeMock.geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    const props = {
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    }
    const { rerender } = renderDeckPreview(props)

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    // Commit an inspector edit; this schedules a reselect for the element.
    const xInput = screen.getByRole('textbox', { name: 'X (%)' })
    await user.clear(xInput)
    await user.type(xInput, '50{enter}')

    expect(onPatchEditorOperations).toHaveBeenCalledTimes(1)
    expect(editorBridgeMock.selectElement).not.toHaveBeenCalled()

    // The patched HTML produces a new preview session; the bridge resets.
    previewFrameMock.iframeKey = 'patched-preview'
    editorBridgeMock.selection = null
    editorBridgeMock.geometry = null

    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )

    expect(editorBridgeMock.selectElement).toHaveBeenCalledWith('ark-el-box', 0)
  })

  it('does not reselect when the user already selected another element', async () => {
    const user = userEvent.setup()
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.editorReady = true
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
    editorBridgeMock.geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    const props = {
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    }
    const { rerender } = renderDeckPreview(props)

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    const xInput = screen.getByRole('textbox', { name: 'X (%)' })
    await user.clear(xInput)
    await user.type(xInput, '50{enter}')

    previewFrameMock.iframeKey = 'patched-preview'
    editorBridgeMock.selection = {
      elementId: 'ark-el-other',
      slideIndex: 0,
      slideId: 'slide-1',
      tagName: 'p',
      locked: false,
      managed: false,
      editableKind: null,
      textPreview: 'Other',
    }

    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )

    expect(editorBridgeMock.selectElement).not.toHaveBeenCalled()
  })

  it('shows inspector image controls for image selections and dispatches fit changes', async () => {
    const user = userEvent.setup()
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)

    editorBridgeMock.selection = {
      elementId: 'ark-el-img',
      slideIndex: 0,
      slideId: 'slide-1',
      tagName: 'img',
      locked: false,
      managed: true,
      editableKind: 'image',
      textPreview: 'A chart',
    }
    editorBridgeMock.geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    })

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    const inspector = screen.getByRole('complementary', { name: 'Element inspector' })
    const fitSelect = within(inspector).getByRole('combobox', { name: 'Image fit mode' })
    await user.selectOptions(fitSelect, 'cover')

    expect(onPatchEditorOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({ op: 'set_inline_style', style: { 'object-fit': 'cover' } }),
        expect.objectContaining({ op: 'set_attrs', attrs: { 'data-ark-fit': 'cover' } }),
      ],
      0,
      'Updated image fit mode',
    )
  })
})
