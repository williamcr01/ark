import { type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import { analyzeDeckInBrowser } from '@/lib/deck-analysis'
import {
  createEditorTransformCommitMessage,
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
    geometryEditable?: boolean
    editableKind: string | null
    textPreview: string | null
  } | null,
  geometry: null as EditorNormalizedRect | null,
  slideBounds: null as EditorNormalizedRect | null,
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

vi.mock('@/lib/runtime-error-api', () => ({
  reportRuntimeError: reportRuntimeErrorMock,
}))

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => [vi.fn(), { width: 1280, height: 720 }],
}))

const plainDeckProps = {
  html: plainCssDeck,
  isGenerating: false,
  isStripOpen: false,
  layout: 'desktop' as const,
  deckAnalysis: analyzeDeckInBrowser(plainCssDeck),
}

describe('DeckPreview script divergence UI', () => {
  beforeEach(() => {
    editorBridgeMock.editorReady = false
    editorBridgeMock.selection = null
    editorBridgeMock.geometry = null
    editorBridgeMock.slideBounds = null
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

  it('shows locked messaging for locked selections', async () => {
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

    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Edit selected text' })).not.toBeInTheDocument()
  })

  it('keeps layer actions disabled until an unlocked selection is adopted', async () => {
    const user = userEvent.setup()
    const onPatchEditorOperations = vi.fn().mockResolvedValue(undefined)
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
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    })

    await user.click(screen.getByRole('button', { name: 'Delete selected element' }))
    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeDisabled()

    expect(onPatchEditorOperations.mock.calls.map(([operations]) => operations[0]?.op)).toEqual([
      'delete_element',
    ])
  })

  it('keeps the floating inspector closed until settings is clicked', async () => {
    const user = userEvent.setup()

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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    expect(screen.queryByRole('dialog', { name: 'Element inspector' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Element settings' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Element settings' }))
    expect(screen.getByRole('dialog', { name: 'Element inspector' })).toBeInTheDocument()
  })

  it('shows the floating inspector settings trigger on mobile when selected', async () => {
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

    renderDeckPreview({ ...plainDeckProps, layout: 'mobile', editorBridgeEnabled: true })

    expect(screen.getByRole('button', { name: 'Element settings' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Element inspector' })).not.toBeInTheDocument()
  })

  it('closes the floating inspector when the selection clears', async () => {
    const user = userEvent.setup()

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

    const { rerender } = renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    await user.click(screen.getByRole('button', { name: 'Element settings' }))
    expect(screen.getByRole('dialog', { name: 'Element inspector' })).toBeInTheDocument()

    editorBridgeMock.selection = null
    editorBridgeMock.geometry = null
    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} editorBridgeEnabled />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Element settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Element inspector' })).not.toBeInTheDocument()
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
      geometryEditable: true,
      editableKind: 'text-box',
      textPreview: 'New text',
    }
    editorBridgeMock.geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    })

    await user.click(screen.getByRole('button', { name: 'Element settings' }))

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
      geometryEditable: true,
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

    // Commit an inspector edit; this schedules a reselect for the element.
    await user.click(screen.getByRole('button', { name: 'Element settings' }))

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

  it('reselects an adopted element by its server-assigned stable id', async () => {
    const onPatchEditorOperations = vi.fn().mockResolvedValue({
      patch: { changedElementIds: ['ark-el-stable'] },
    })
    const geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }
    editorBridgeMock.editorReady = true
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
    editorBridgeMock.geometry = geometry
    const props = { ...plainDeckProps, editorBridgeEnabled: true, onPatchEditorOperations }
    const { rerender } = renderDeckPreview(props)

    editorBridgeMock.transformCommit = createEditorTransformCommitMessage(
      'transient-el-0-0',
      0,
      geometry,
      undefined,
      undefined,
      true,
    )
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )
    await act(async () => undefined)

    previewFrameMock.iframeKey = 'adopted-preview'
    editorBridgeMock.selection = null
    editorBridgeMock.geometry = null
    editorBridgeMock.transformCommit = null
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )

    expect(editorBridgeMock.selectElement).toHaveBeenCalledWith('ark-el-stable', 0)
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
      geometryEditable: true,
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

    await user.click(screen.getByRole('button', { name: 'Element settings' }))

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
      managed: false,
      editableKind: 'image',
      textPreview: 'A chart',
    }
    editorBridgeMock.geometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      onPatchEditorOperations,
    })

    await user.click(screen.getByRole('button', { name: 'Element settings' }))

    const inspector = screen.getByRole('dialog', { name: 'Element inspector' })
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

  it('shows, dismisses, and replaces runtime errors with structured repair context', async () => {
    const user = userEvent.setup()

    renderDeckPreview({
      ...plainDeckProps,
      deckId: '11111111-1111-4111-8111-111111111111',
      recentGenerationJobId: '22222222-2222-4222-8222-222222222222',
      documentRevision: 3,
    })

    const navigationOptions = deckSlideNavigationOptionsMock.mock.calls.at(-1)?.[0] as {
      onRuntimeError: (message: string, source?: string) => void
    }

    act(() => navigationOptions.onRuntimeError('Reveal failed to initialize', 'reveal.js'))

    expect(screen.getByRole('alert')).toHaveTextContent('Runtime error on slide 1')
    expect(screen.getByRole('alert')).toHaveTextContent('Reveal failed to initialize')
    expect(reportRuntimeErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Reveal failed to initialize',
        repairContext: expect.objectContaining({
          affectedSlideIndex: 0,
          errorSummary: 'Reveal failed to initialize',
          relatedJobId: '22222222-2222-4222-8222-222222222222',
          validation: expect.objectContaining({ status: 'valid' }),
          documentRevision: 3,
        }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Dismiss runtime error' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => navigationOptions.onRuntimeError('A later distinct failure', 'deck.js'))
    expect(screen.getByRole('alert')).toHaveTextContent('A later distinct failure')
  })

  it('allows retrying the same runtime error after a report failure', async () => {
    reportRuntimeErrorMock.mockRejectedValueOnce(new Error('network down'))

    renderDeckPreview({
      ...plainDeckProps,
      deckId: '11111111-1111-4111-8111-111111111111',
      documentRevision: 3,
    })

    const navigationOptions = deckSlideNavigationOptionsMock.mock.calls.at(-1)?.[0] as {
      onRuntimeError: (message: string, source?: string) => void
    }

    act(() => navigationOptions.onRuntimeError('Transient failure', 'deck.js'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(reportRuntimeErrorMock).toHaveBeenCalledTimes(1)

    act(() => navigationOptions.onRuntimeError('Transient failure', 'deck.js'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(reportRuntimeErrorMock).toHaveBeenCalledTimes(2)
  })

  it('keeps runtime errors distinct from validation and network failures', () => {
    const invalidHtml = plainCssDeck.replace(
      '</body>',
      '<img src="https://example.com/tracker.png" alt=""></body>',
    )
    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      html: invalidHtml,
      deckAnalysis: analyzeDeckInBrowser(invalidHtml),
    })
    const navigationOptions = deckSlideNavigationOptionsMock.mock.calls.at(-1)?.[0] as {
      onRuntimeError: (message: string, source?: string) => void
    }

    act(() => navigationOptions.onRuntimeError('Deck script crashed', 'deck.js'))

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          html={invalidHtml}
          deckAnalysis={analyzeDeckInBrowser(invalidHtml)}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Network access blocked')).toBeInTheDocument()
    expect(screen.getByText('Deck script crashed').closest('[role="alert"]')).toHaveTextContent(
      'Deck script crashed',
    )
  })

  it('caps hostile runtime error reports per document revision', () => {
    renderDeckPreview({
      ...plainDeckProps,
      deckId: '11111111-1111-4111-8111-111111111111',
      documentRevision: 3,
    })

    for (let index = 0; index < 25; index += 1) {
      const navigationOptions = deckSlideNavigationOptionsMock.mock.calls.at(-1)?.[0] as {
        onRuntimeError: (message: string, source?: string) => void
      }
      act(() => navigationOptions.onRuntimeError(`Hostile failure ${index}`, 'hostile.js'))
    }

    expect(reportRuntimeErrorMock).toHaveBeenCalledTimes(20)
    expect(screen.getByRole('alert')).toHaveTextContent('Hostile failure 19')
  })

  it('only assigns clearEditorSelectionRef while the editor bridge is active', () => {
    const clearEditorSelectionRef = { current: null as (() => boolean) | null }

    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      clearEditorSelectionRef,
      editorBridgeEnabled: false,
      isGenerating: false,
    })

    expect(clearEditorSelectionRef.current).toBeNull()

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          clearEditorSelectionRef={clearEditorSelectionRef}
          editorBridgeEnabled
          isGenerating={false}
        />
      </TooltipProvider>,
    )

    expect(clearEditorSelectionRef.current).toBe(editorBridgeMock.clearSelection)

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          clearEditorSelectionRef={clearEditorSelectionRef}
          editorBridgeEnabled
          isGenerating
        />
      </TooltipProvider>,
    )

    expect(clearEditorSelectionRef.current).toBeNull()
  })
})
