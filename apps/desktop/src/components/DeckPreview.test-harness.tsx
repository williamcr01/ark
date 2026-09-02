import type { MutableRefObject, RefObject } from 'react'

import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'
import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import type { DeckTextEditCommit } from '@/lib/editor/deck-text-edit'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { EditorSelectionInfo } from '@ark/editor-runtime'

import { previewManualEdits } from './DeckPreview.test-edits'
import { DeckPreview } from './DeckPreview'

type LegacyDeckPreviewProps = {
  html: string
  deckId?: string | null
  documentRevision?: number | null
  recentGenerationJobId?: string | null
  state: {
    isDeckLoading: boolean
    isGenerating: boolean
    isPreviewUpdating: boolean
    isStripOpen: boolean
    editorBridgeEnabled: boolean
    isTextEditSaving: boolean
    canUndo: boolean
    canRedo: boolean
  }
  layout: 'desktop' | 'mobile'
  deckAnalysis?: DeckBrowserAnalysis
  chromeHost?: HTMLElement | null
  initialSlideIndex?: number
  undoSlideIndex?: number | null
  redoSlideIndex?: number | null
  contextSlideIndexes?: number[]
  clearEditorSelectionRef?: MutableRefObject<(() => boolean) | null>
  onUndo?: () => void | Promise<void>
  onRedo?: () => void | Promise<void>
  onRestoreDocumentHistory?: (revision: number) => Promise<void>
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<DeckPreviewPatchResult | undefined>
  onEditorSelectionChange?: (
    selection: EditorSelectionInfo | null,
    selections?: EditorSelectionInfo[],
  ) => void
  onToggleContextSlide?: (index: number) => void
  onReorderSlide?: (
    fromIndex: number,
    toIndex: number,
    activeSlideIndex: number,
  ) => Promise<DeckPreviewPatchResult | undefined>
  onPatchEditorOperations?: (
    operations: DeckElementPatchOperation[],
    activeSlideIndex: number,
    summary: string,
  ) => Promise<DeckPreviewPatchResult | undefined>
  presentHandleRef?: RefObject<DeckPreviewHandle | null>
}

function applyLegacyPreviewProps(props: LegacyDeckPreviewProps) {
  useDeckStore.setState({
    html: props.html,
    deckId: props.deckId ?? null,
    documentRevision: props.documentRevision ?? null,
    isLoading: props.state.isDeckLoading,
    isPatching: props.state.isTextEditSaving,
    isSaving: false,
  })
  useChatStore.setState({
    isGenerating: props.state.isGenerating,
    isPreviewUpdating: props.state.isPreviewUpdating,
  })
  useEditorStore.setState({
    isStripOpen: props.state.isStripOpen,
    ...(props.contextSlideIndexes
      ? { contextSlides: props.contextSlideIndexes.map((slideIndex) => ({ slideIndex })) }
      : {}),
  })
  previewManualEdits.canUndo = props.state.canUndo
  previewManualEdits.canRedo = props.state.canRedo
  previewManualEdits.undoSlideIndex = props.undoSlideIndex ?? null
  previewManualEdits.redoSlideIndex = props.redoSlideIndex ?? null
  previewManualEdits.handleCommitTextEdit = props.onCommitTextEdit ?? (async () => undefined)
  previewManualEdits.handlePatchEditorOperations =
    props.onPatchEditorOperations ?? (async () => undefined)
  previewManualEdits.handleReorderSlide = props.onReorderSlide ?? (async () => undefined)
  previewManualEdits.handleUndoEdit = props.onUndo ?? (() => undefined)
  previewManualEdits.handleRedoEdit = props.onRedo ?? (() => undefined)
  previewManualEdits.handleRestoreDocumentHistory =
    props.onRestoreDocumentHistory ?? (async () => undefined)
}

export function PreviewTestHost(props: LegacyDeckPreviewProps) {
  applyLegacyPreviewProps(props)
  return (
    <DeckPreview
      chromeHost={props.chromeHost}
      clearEditorSelectionRef={props.clearEditorSelectionRef}
      editorBridgeEnabled={props.state.editorBridgeEnabled}
      initialSlideIndex={props.initialSlideIndex}
      layout={props.layout}
      onToggleContextSlide={props.onToggleContextSlide}
      presentHandleRef={props.presentHandleRef}
    />
  )
}
