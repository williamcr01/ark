import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckEditorBridgeState } from '@/lib/editor/editor-bridge-state.ts'
import type { DeckTextEditCommit } from '@/lib/editor/deck-text-edit.ts'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'

import { useEditorDragCommit } from './useEditorDragCommit.ts'
import { useEditorPatchQueue } from './useEditorPatchQueue.ts'
import { useEditorPatchSession } from './useEditorPatchSession.ts'
import { useEditorRuntimePatches } from './useEditorRuntimePatches.ts'

export type { DeckTextEditCommit } from '@/lib/editor/deck-text-edit.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

type UseDeckEditorPatchCoordinatorOptions = {
  activeSlideIndex: number
  canRedo: boolean
  canUndo: boolean
  editChromeActive: boolean
  editorReady: boolean
  geometry: DeckEditorBridgeState['geometry']
  iframeKey: string
  isTextEditSaving: boolean
  lastDeleteRequest: DeckEditorBridgeState['lastDeleteRequest']
  lastInsertRequest: DeckEditorBridgeState['lastInsertRequest']
  lastShortcutRequest: DeckEditorBridgeState['lastShortcutRequest']
  lastTextCommit: DeckEditorBridgeState['lastTextCommit']
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<DeckPreviewPatchResult | undefined>
  onPatchEditorOperations?: PatchOperations
  onRedo?: () => void | Promise<void>
  onSelectElement: (elementId: string, slideIndex: number) => void
  onSelectTool: (tool: EditorTool) => void
  onUndo?: () => void | Promise<void>
  preserveRedoSlideIndex?: number | null
  preserveUndoSlideIndex?: number | null
  previewContentRevision: number
  selection: EditorSelectionInfo | null
  selections?: EditorSelectionInfo[]
  scopeKey: string | null
  textEditActive: boolean
  transformCancelSequence: number
  transformCommit: DeckEditorBridgeState['transformCommit']
  transformPreview: DeckEditorBridgeState['transformPreview']
  beginLivePatch: (elementId: string) => boolean
  finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void
  goToSlide: (slideIndex: number) => void
  rollbackLivePatch: () => void
  onAssignElementId?: (
    fromElementId: string,
    toElementId: string,
    slideIndex: number,
    managed?: boolean,
  ) => void
}

function assemblePatchCoordinator(queue: ReturnType<typeof useEditorPatchQueue>) {
  return {
    canEditSelectedText: queue.canEditSelectedText,
    handleDeleteSelection: queue.selectionActions.delete,
    handleDuplicateSelection: queue.selectionActions.duplicate,
    handleImageAltChange: queue.selectionActions.imageAlt,
    handleImageFitChange: queue.selectionActions.imageFit,
    handleInsertImageFile: queue.handleInsertImageFile,
    handleInspectorApply: queue.handleInspectorApply,
    handleRedo: queue.handleRedo,
    handleReorderSelection: queue.selectionActions.reorder,
    handleUndo: queue.handleUndo,
    selectedImage: queue.selectedImage,
    selectedImageAlt: queue.selectedImageAlt,
    selectedImageFit: queue.selectedImageFit,
  }
}

export function useDeckEditorPatchCoordinator(options: UseDeckEditorPatchCoordinatorOptions) {
  const session = useEditorPatchSession(options.scopeKey)
  const queue = useEditorPatchQueue({ ...options, session })
  useEditorDragCommit({
    activeSlideIndex: options.activeSlideIndex,
    beginLivePatch: options.beginLivePatch,
    completeLivePatch: queue.live.completeLivePatch,
    geometry: options.geometry,
    onPatchEditorOperations: options.onPatchEditorOperations,
    rollbackLivePatch: options.rollbackLivePatch,
    scheduleReselect: queue.live.scheduleReselect,
    selection: options.selection,
    session,
    transformCancelSequence: options.transformCancelSequence,
    transformCommit: options.transformCommit,
    transformPreview: options.transformPreview,
  })
  useEditorRuntimePatches({
    activeSlideIndex: options.activeSlideIndex,
    beginLivePatch: options.beginLivePatch,
    completeLivePatch: queue.live.completeLivePatch,
    duplicateElement: queue.live.duplicateElement,
    editChromeActive: options.editChromeActive,
    editorReady: options.editorReady,
    goToSlide: options.goToSlide,
    handleDuplicateSelection: queue.selectionActions.duplicate,
    handleRedo: queue.handleRedo,
    handleUndo: queue.handleUndo,
    iframeKey: options.iframeKey,
    isTextEditSaving: options.isTextEditSaving,
    lastDeleteRequest: options.lastDeleteRequest,
    lastInsertRequest: options.lastInsertRequest,
    lastShortcutRequest: options.lastShortcutRequest,
    lastTextCommit: options.lastTextCommit,
    onCommitTextEdit: options.onCommitTextEdit,
    onPatchEditorOperations: options.onPatchEditorOperations,
    onSelectElement: options.onSelectElement,
    onSelectTool: options.onSelectTool,
    previewContentRevision: options.previewContentRevision,
    rollbackLivePatch: options.rollbackLivePatch,
    scheduleReselect: queue.live.scheduleReselect,
    selection: options.selection,
    selectionSet: queue.live.selectionSet,
    session,
    textEditActive: options.textEditActive,
    transformCommit: options.transformCommit,
    transformPreview: options.transformPreview,
  })
  return assemblePatchCoordinator(queue)
}
