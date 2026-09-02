import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import type { UseDeckEditorPatchCoordinatorOptions } from '@/hooks/useDeckEditorPatchCoordinator'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'

export function createDeckEditorCoordinatorInput(args: {
  activeSlideIndex: number
  beginLivePatch: (elementId: string) => boolean
  contentRevision: number
  deckId: string | null
  editChromeActive: boolean
  edits: ReturnType<typeof useManualEditCommits>
  finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void
  goToSlide: (index: number) => void
  handleToolChange: (tool: EditorTool) => void
  iframeKey: string
  isTextEditSaving: boolean
  rollbackLivePatch: () => void
  bridge: {
    assignElementId: UseDeckEditorPatchCoordinatorOptions['onAssignElementId']
    editorReady: boolean
    geometry: UseDeckEditorPatchCoordinatorOptions['geometry']
    lastDeleteRequest: UseDeckEditorPatchCoordinatorOptions['lastDeleteRequest']
    lastInsertRequest: UseDeckEditorPatchCoordinatorOptions['lastInsertRequest']
    lastShortcutRequest: UseDeckEditorPatchCoordinatorOptions['lastShortcutRequest']
    lastTextCommit: UseDeckEditorPatchCoordinatorOptions['lastTextCommit']
    selectElement: UseDeckEditorPatchCoordinatorOptions['onSelectElement']
    selection: EditorSelectionInfo | null
    selections: EditorSelectionInfo[]
    textEditActive: boolean
    transformCancelSequence: number
    transformCommit: UseDeckEditorPatchCoordinatorOptions['transformCommit']
    transformPreview: UseDeckEditorPatchCoordinatorOptions['transformPreview']
  }
}): UseDeckEditorPatchCoordinatorOptions {
  const { bridge, edits } = args
  return {
    activeSlideIndex: args.activeSlideIndex,
    canRedo: edits.canRedo,
    canUndo: edits.canUndo,
    editChromeActive: args.editChromeActive,
    editorReady: bridge.editorReady,
    geometry: bridge.geometry,
    iframeKey: args.iframeKey,
    isTextEditSaving: args.isTextEditSaving,
    lastDeleteRequest: bridge.lastDeleteRequest,
    lastInsertRequest: bridge.lastInsertRequest,
    lastShortcutRequest: bridge.lastShortcutRequest,
    lastTextCommit: bridge.lastTextCommit,
    onCommitTextEdit: edits.handleCommitTextEdit,
    onPatchEditorOperations: edits.handlePatchEditorOperations,
    onRedo: edits.handleRedoEdit,
    onSelectElement: bridge.selectElement,
    onSelectTool: args.handleToolChange,
    onUndo: edits.handleUndoEdit,
    preserveRedoSlideIndex: edits.redoSlideIndex,
    preserveUndoSlideIndex: edits.undoSlideIndex,
    previewContentRevision: args.contentRevision,
    selection: bridge.selection,
    selections: bridge.selections,
    scopeKey: args.deckId,
    textEditActive: bridge.textEditActive,
    transformCancelSequence: bridge.transformCancelSequence,
    transformCommit: bridge.transformCommit,
    transformPreview: bridge.transformPreview,
    beginLivePatch: args.beginLivePatch,
    finishLivePatch: args.finishLivePatch,
    goToSlide: args.goToSlide,
    rollbackLivePatch: args.rollbackLivePatch,
    onAssignElementId: bridge.assignElementId,
  }
}
