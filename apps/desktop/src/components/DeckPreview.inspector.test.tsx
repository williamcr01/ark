import { createRef, type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import fullJsDeck from '@fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'
import revealChartDeck from '@fixtures/reveal-chart-deck.html?raw'
import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import {
  type EditorNormalizedRect,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
} from '@ark/editor-runtime'

import { DeckPreview, type DeckPreviewHandle } from './DeckPreview'

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
    // Simulate the real bridge's event-driven selection reporting so the
    // shell-facing onEditorSelectionChange prop receives the same events the
    // real editor MessagePort listener emits.
    const options = args[1] as { onSelectionChange?: (selection: unknown) => void } | undefined
    options?.onSelectionChange?.(editorBridgeMock.selection)
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

  it('sets empty allow and credentialless on the preview iframe', () => {
    renderDeckPreview(plainDeckProps)

    const iframe = screen.getByTitle('Generated Ark presentation preview')

    expect(iframe).toHaveAttribute('allow', '')
    expect(iframe).toHaveAttribute('credentialless')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe).toHaveAttribute('referrerPolicy', 'no-referrer')
  })

  it('does not post editor enable after compromise even if onLoad races', async () => {
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
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

  it('reuses the main preview frame when opening present mode', () => {
    const previewRef = createRef<DeckPreviewHandle>()
    renderDeckPreview({ ...plainDeckProps, presentHandleRef: previewRef })

    const previewIframe = screen.getByTitle('Generated Ark presentation preview')

    act(() => previewRef.current?.openPresent())

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(screen.queryByTitle('Ark presentation mode')).not.toBeInTheDocument()
    expect(screen.getByTitle('Generated Ark presentation preview')).toBe(previewIframe)
    expect(screen.getAllByTitle('Generated Ark presentation preview')).toHaveLength(1)
    expect(useDeckPreviewFrameMock).toHaveBeenLastCalledWith(plainCssDeck, true, 0, null)
    expect(useDeckPreviewFrameMock.mock.calls.every((call) => call[1] === true)).toBe(true)
  })

  it('hides preview chrome overlays while present mode is open', () => {
    const previewRef = createRef<DeckPreviewHandle>()
    renderDeckPreview({
      state: { ...plainDeckProps.state, isGenerating: false, isStripOpen: false },
      html: hostileScriptsDeck,
      layout: 'desktop',
      deckAnalysis: analyzeDeckInBrowser(hostileScriptsDeck),
      presentHandleRef: previewRef,
    })

    expect(screen.getByText(/Scripts and inline handlers were removed for preview/i)).toBeVisible()

    act(() => previewRef.current?.openPresent())

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(
      screen.queryByText(/Scripts and inline handlers were removed for preview/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Download the original HTML to keep executable code/i),
    ).not.toBeInTheDocument()
  })

  it('disables then re-enables the editor when presenting', async () => {
    const user = userEvent.setup()
    const previewRef = createRef<DeckPreviewHandle>()
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      presentHandleRef: previewRef,
    })
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    editorBridgeMock.editorReady = true

    editorBridgeMock.disableEditor.mockClear()
    editorBridgeMock.enableEditor.mockClear()

    act(() => previewRef.current?.openPresent())

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
      state: { ...plainDeckProps.state, isGenerating: false, isStripOpen: false },
      html: hostileScriptsDeck,
      layout: 'desktop',
      deckAnalysis: analyzeDeckInBrowser(hostileScriptsDeck),
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
      state: { ...plainDeckProps.state, isGenerating: false, isStripOpen: false },
      html: revealRegistryDeck,
      layout: 'desktop',
      deckAnalysis: analyzeDeckInBrowser(revealRegistryDeck),
    })

    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
    expect(screen.getByTitle('Generated Ark presentation preview')).toBeInTheDocument()
  })

  it('enables edit chrome by default when the editor bridge is on', () => {
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    expect(screen.queryByRole('button', { name: 'Edit mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
  })

  it('keeps persistent manual editing enabled for custom-JS decks', () => {
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      html: fullJsDeck,
      deckAnalysis: analyzeDeckInBrowser(fullJsDeck),
    })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(editorBridgeOptionsMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        enabled: true,
        sessionHandshake: previewFrameMock.handshake,
      }),
    )
  })

  it('keeps persistent editing enabled when approved runtime decks execute init scripts', () => {
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      html: revealChartDeck,
      deckAnalysis: analyzeDeckInBrowser(revealChartDeck),
    })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(editorBridgeOptionsMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        enabled: true,
        sessionHandshake: previewFrameMock.handshake,
      }),
    )
  })

  it('keeps slide navigation chrome visible while editing', () => {
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true, isStripOpen: true },
    })
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to slide 1' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Go to slide 3' })).toBeInTheDocument()
  })

  it('navigates to the server-remapped active slide after a reorder', async () => {
    const onReorderSlide = vi.fn().mockResolvedValue({
      patch: {
        appliedCount: 1,
        changedElementIds: [],
        changedSlideIndexes: [0, 2],
        suggestedActiveSlideIndex: 2,
        summary: 'Moved slide from index 0 to 2.',
      },
    })
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true, isStripOpen: true },
      onReorderSlide,
    })
    goToSlideMock.mockClear()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Go to slide 1' }), {
      altKey: true,
      key: 'ArrowDown',
    })

    await waitFor(() => expect(onReorderSlide).toHaveBeenCalledWith(0, 1, 0))
    expect(goToSlideMock).toHaveBeenCalledWith(2)
  })

  it('pauses edit chrome when generation starts', () => {
    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          state={{ ...plainDeckProps.state, editorBridgeEnabled: true, isGenerating: true }}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
    expect(editorBridgeMock.disableEditor).toHaveBeenCalled()
  })

  it('shows the preview update indicator only while a changed deck is refreshing', () => {
    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, isGenerating: true },
    })

    expect(screen.queryByText('Updating preview')).not.toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          state={{ ...plainDeckProps.state, isPreviewUpdating: true }}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Updating preview')).toBeVisible()

    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} />
      </TooltipProvider>,
    )

    expect(screen.queryByText('Updating preview')).not.toBeInTheDocument()
  })

  it('keeps the empty stage during new-deck generation instead of a fake slide skeleton', () => {
    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      html: '',
      deckAnalysis: analyzeDeckInBrowser(''),
    })

    expect(screen.getByText('Set the stage')).toBeVisible()
    expect(screen.queryByTitle('Generated Ark presentation preview')).not.toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          deckAnalysis={analyzeDeckInBrowser('')}
          html=""
          state={{ ...plainDeckProps.state, isGenerating: true }}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Set the stage')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Building your deck…')
    expect(screen.queryByTitle('Generated Ark presentation preview')).not.toBeInTheDocument()
  })

  it('uses size-locked preview and thumbnail skeletons while opening a deck', () => {
    const { container } = renderDeckPreview({
      ...plainDeckProps,
      state: {
        ...plainDeckProps.state,
        editorBridgeEnabled: true,
        isDeckLoading: true,
        isStripOpen: true,
      },
      deckAnalysis: analyzeDeckInBrowser(''),
      html: '',
    })

    const preview = screen.getByRole('status', { name: 'Loading deck preview' })
    const strip = screen.getByLabelText('Loading slide thumbnails')
    const thumbnailSkeletons = strip.querySelectorAll(
      '[data-slot="slide-reorder-zone"] [data-slot="skeleton"]',
    )

    expect(preview).toHaveStyle({ height: '720px', width: '1280px' })
    expect(container.querySelector('[data-slot="deck-toolbar-skeleton"]')).toHaveClass('h-9')
    expect(strip).toHaveClass('w-[168px]')
    expect(thumbnailSkeletons).toHaveLength(5)
    expect(thumbnailSkeletons[0]).toHaveAttribute('style', 'aspect-ratio: 1280 / 720;')
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByText('Set the stage')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Generated Ark presentation preview')).not.toBeInTheDocument()
  })

  it('reports editor selection to the shell while edit chrome is active', () => {
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

    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
      onEditorSelectionChange,
    })

    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementId: 'ark-el-1' }),
    )

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          state={{ ...plainDeckProps.state, editorBridgeEnabled: true, isGenerating: true }}
          onEditorSelectionChange={onEditorSelectionChange}
        />
      </TooltipProvider>,
    )
    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('enables the editor bridge when the edit-mode iframe loads', async () => {
    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
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

    expect(editorBridgeMock.enableEditor).toHaveBeenCalledWith(0, 'select', 1)
  })

  it('configures runtime chrome with the preview scale', () => {
    editorBridgeMock.editorReady = true

    renderDeckPreview({
      ...plainDeckProps,
      state: { ...plainDeckProps.state, editorBridgeEnabled: true },
    })
    expect(editorBridgeMock.configureEditor).toHaveBeenCalledWith(1)
  })

  it('starts thumbnail work only after the current main preview is ready', async () => {
    const props = {
      ...plainDeckProps,
      deckId: 'b0000000-0000-4000-8000-000000000001',
      documentRevision: 1,
    }
    const { rerender } = renderDeckPreview(props)

    expect(useDeckThumbnailsMock).toHaveBeenLastCalledWith(
      props.deckId,
      props.documentRevision,
      3,
      {
        enabled: false,
      },
    )

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

    expect(useDeckThumbnailsMock).toHaveBeenLastCalledWith(
      props.deckId,
      props.documentRevision,
      3,
      {
        enabled: true,
      },
    )

    previewFrameMock.isStale = true
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )

    expect(useDeckThumbnailsMock).toHaveBeenLastCalledWith(
      props.deckId,
      props.documentRevision,
      3,
      {
        enabled: false,
      },
    )
  })
})
