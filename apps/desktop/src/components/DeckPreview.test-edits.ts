import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckTextEditCommit } from '@/lib/editor/deck-text-edit'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'

export const previewManualEdits = {
  canUndo: false,
  canRedo: false,
  undoSlideIndex: null as number | null,
  redoSlideIndex: null as number | null,
  handleCommitTextEdit: (async () => undefined) as (
    commit: DeckTextEditCommit,
  ) => Promise<DeckPreviewPatchResult | undefined>,
  handlePatchEditorOperations: (async () => undefined) as (
    operations: DeckElementPatchOperation[],
    activeSlideIndex: number,
    summary: string,
  ) => Promise<DeckPreviewPatchResult | undefined>,
  handleReorderSlide: (async () => undefined) as (
    fromIndex: number,
    toIndex: number,
    activeSlideIndex: number,
  ) => Promise<DeckPreviewPatchResult | undefined>,
  handleUndoEdit: (() => undefined) as () => void | Promise<void>,
  handleRedoEdit: (() => undefined) as () => void | Promise<void>,
  handleRestoreDocumentHistory: (async () => undefined) as (revision: number) => Promise<void>,
}
