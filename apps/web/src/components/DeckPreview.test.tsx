import { type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import fullJsDeck from '@fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'
import revealChartDeck from '@fixtures/reveal-chart-deck.html?raw'
import { analyzeDeckInBrowser } from '@/lib/deck-analysis'
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
    geometryEditable?: boolean
    editableKind: string | null
    textPreview: string | null
  } | null,
  geometry: null as EditorNormalizedRect | null,
  slideBounds: null as EditorNormalizedRect | null,
  selectionZIndex: null,
  hover: null,
  hoverGeometry: null,
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
  clearSelection: vi.fn(),
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
    iframeSrcDoc: '<html></html>',
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
      goToSlide: vi.fn(),
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
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

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
    expect(useDeckPreviewFrameMock).toHaveBeenLastCalledWith(plainCssDeck, true, 0)
    expect(useDeckPreviewFrameMock.mock.calls.every((call) => call[1] === true)).toBe(true)
  })

  it('hides preview chrome overlays while present mode is open', async () => {
    const user = userEvent.setup()
    renderDeckPreview({
      html: hostileScriptsDeck,
      isGenerating: false,
      isStripOpen: false,
      layout: 'desktop',
      deckAnalysis: analyzeDeckInBrowser(hostileScriptsDeck),
    })

    expect(screen.getByText(/Scripts and inline handlers were removed for preview/i)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

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
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })
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
      html: revealRegistryDeck,
      isGenerating: false,
      isStripOpen: false,
      layout: 'desktop',
      deckAnalysis: analyzeDeckInBrowser(revealRegistryDeck),
    })

    expect(screen.getAllByText('Reveal runtime').length).toBeGreaterThan(0)
    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })

  it('enables edit chrome by default when the editor bridge is on', () => {
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    expect(screen.queryByRole('button', { name: 'Edit mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })

  it('keeps persistent manual editing enabled for custom-JS decks', () => {
    renderDeckPreview({
      ...plainDeckProps,
      html: fullJsDeck,
      deckAnalysis: analyzeDeckInBrowser(fullJsDeck),
      editorBridgeEnabled: true,
    })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(screen.getByText('Scripts running')).toBeInTheDocument()
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
      html: revealChartDeck,
      deckAnalysis: analyzeDeckInBrowser(revealChartDeck),
      editorBridgeEnabled: true,
    })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(screen.getByText('Scripts running')).toBeInTheDocument()
    expect(editorBridgeOptionsMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        enabled: true,
        sessionHandshake: previewFrameMock.handshake,
      }),
    )
  })

  it('keeps slide navigation chrome visible while editing', () => {
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(screen.getByText('Slide 1 of 3')).toBeInTheDocument()
  })

  it('pauses edit chrome when generation starts', () => {
    const { rerender } = renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
    })

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} editorBridgeEnabled isGenerating />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
    expect(editorBridgeMock.disableEditor).toHaveBeenCalled()
  })

  it('shows the preview update indicator only while a changed deck is refreshing', () => {
    const { rerender } = renderDeckPreview({ ...plainDeckProps, isGenerating: true })

    expect(screen.queryByText('Updating preview')).not.toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <DeckPreview {...plainDeckProps} isPreviewUpdating />
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
      editorBridgeEnabled: true,
      onEditorSelectionChange,
    })

    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementId: 'ark-el-1' }),
    )

    rerender(
      <TooltipProvider>
        <DeckPreview
          {...plainDeckProps}
          editorBridgeEnabled
          isGenerating
          onEditorSelectionChange={onEditorSelectionChange}
        />
      </TooltipProvider>,
    )
    expect(onEditorSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('enables the editor bridge when the edit-mode iframe loads', async () => {
    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

    expect(editorBridgeMock.configureEditor).toHaveBeenCalledWith(1)
  })

  it('starts thumbnail work only after the current main preview is ready', async () => {
    const props = {
      ...plainDeckProps,
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
    }
    const { rerender } = renderDeckPreview(props)

    expect(useDeckThumbnailsMock).toHaveBeenLastCalledWith(props.deckId, props.versionId, 3, {
      enabled: false,
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

    expect(useDeckThumbnailsMock).toHaveBeenLastCalledWith(props.deckId, props.versionId, 3, {
      enabled: true,
    })

    previewFrameMock.isStale = true
    rerender(
      <TooltipProvider>
        <DeckPreview {...props} />
      </TooltipProvider>,
    )

    expect(useDeckThumbnailsMock).toHaveBeenLastCalledWith(props.deckId, props.versionId, 3, {
      enabled: false,
    })
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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })

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

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(editorBridgeMock.cancelTextEdit).toHaveBeenCalled()
  })

  it('resets the active tool when Escape is pressed outside text editing', async () => {
    const user = userEvent.setup()

    renderDeckPreview({ ...plainDeckProps, editorBridgeEnabled: true })
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
      editorBridgeEnabled: true,
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

    expect(useDeckPreviewFrameMock).toHaveBeenLastCalledWith(beforeHtml, true, 0)
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
    const props = { ...plainDeckProps, editorBridgeEnabled: true, onPatchEditorOperations }
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
      editorBridgeEnabled: true,
      canUndo: true,
      canRedo: true,
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
      editorBridgeEnabled: true,
      canUndo: true,
      canRedo: true,
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
      editorBridgeEnabled: true,
      canUndo: true,
      canRedo: true,
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
        editorBridgeEnabled: true,
        canUndo: true,
        canRedo: true,
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
      editorBridgeEnabled: true,
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
        editorBridgeEnabled: true,
        canUndo,
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
      editorBridgeEnabled: true,
      canUndo: true,
      onUndo,
    })

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not undo with keyboard when nothing is undoable', async () => {
    const onUndo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: false,
      onUndo,
    })

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not undo with keyboard while a patch is saving', async () => {
    const onUndo = vi.fn()

    renderDeckPreview({
      ...plainDeckProps,
      editorBridgeEnabled: true,
      canUndo: true,
      isTextEditSaving: true,
      onUndo,
    })

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(onUndo).not.toHaveBeenCalled()
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
      versionId: '33333333-3333-4333-8333-333333333333',
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
          versionId: '33333333-3333-4333-8333-333333333333',
        }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Dismiss runtime error' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => navigationOptions.onRuntimeError('A later distinct failure', 'deck.js'))
    expect(screen.getByRole('alert')).toHaveTextContent('A later distinct failure')
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
    expect(screen.getByRole('alert')).toHaveTextContent('Deck script crashed')
  })

  it('caps hostile runtime error reports per deck version', () => {
    renderDeckPreview({
      ...plainDeckProps,
      deckId: '11111111-1111-4111-8111-111111111111',
      versionId: '33333333-3333-4333-8333-333333333333',
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
})
