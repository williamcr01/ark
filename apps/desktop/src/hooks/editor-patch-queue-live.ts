import { toast } from 'sonner'

import { pickStableChangedElementId } from '@/lib/editor/deck-editor-patches'
import {
  buildImageInsertOperation,
  prepareImageInsertFromFile,
} from '@/lib/editor/deck-image-insert'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export function completeLivePatchResult(
  result: DeckPreviewPatchResult | undefined,
  sync: { fromElementId: string; slideIndex: number; managed?: boolean } | undefined,
  onAssignElementId:
    | ((fromElementId: string, toElementId: string, slideIndex: number, managed?: boolean) => void)
    | undefined,
  finishLivePatchAndClearDeferred: (result: DeckPreviewPatchResult | undefined) => void,
  finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void,
) {
  const keptLive = Boolean(result?.deck?.html)
  if (keptLive) {
    if (sync && onAssignElementId && result) {
      const toElementId = pickStableChangedElementId(result.patch.changedElementIds)
      if (toElementId && toElementId !== sync.fromElementId) {
        onAssignElementId(sync.fromElementId, toElementId, sync.slideIndex, sync.managed)
      }
    }
    finishLivePatchAndClearDeferred(result)
    return
  }

  finishLivePatch(result)
}

export async function insertImageFromFile(args: {
  file: File
  position: { x: number; y: number } | undefined
  scopeKey: string | null
  scopeGenerationRef: { current: number }
  preserveSlideIndexRef: { current: number | null }
  activeSlideIndex: number
  onPatchEditorOperations?: PatchOperations
  onSelectTool: (tool: EditorTool) => void
}) {
  if (!args.onPatchEditorOperations || !args.scopeKey) {
    toast.error('Save the deck before inserting images')
    return
  }

  try {
    const generation = args.scopeGenerationRef.current
    const prepared = await prepareImageInsertFromFile(args.scopeKey, args.file, args.position)
    if (args.scopeGenerationRef.current !== generation) {
      return
    }
    args.preserveSlideIndexRef.current = args.activeSlideIndex
    await args.onPatchEditorOperations(
      [buildImageInsertOperation(args.activeSlideIndex, prepared, null)],
      args.activeSlideIndex,
      'Inserted image in preview',
    )
    args.onSelectTool('select')
  } catch (insertError) {
    toast.error(insertError instanceof Error ? insertError.message : 'Could not insert the image')
  }
}
