import { useEffect, useRef, useState } from 'react'

import type { EditorNormalizedRect, EditorSelectionInfo } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { ImageFitMode } from '@ark/deck/document/image.ts'
import {
  applyInspectorOperations,
  buildAttrsOperation,
  buildGeometryFieldOperation,
  buildImageFitOperations,
  buildInlineStyleOperation,
  buildLockToggleOperation,
  buildReorderElementOperation,
  COLOR_COMMIT_DEBOUNCE_MS,
  cssColorToHex,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  lockToggleSummary,
  parseClampedPxInput,
  parsePercentInput,
  reorderElementSummary,
  type InspectorGeometryField,
} from '@/lib/editor/element-inspector'

type UseInspectorActionsArgs = {
  geometry: EditorNormalizedRect | null
  onApplyOperations?: (operations: DeckElementPatchOperation[], summary: string) => void
  selection: EditorSelectionInfo | null
}

function colorValueForSelection(selection: EditorSelectionInfo | null, colorDraft: string | null) {
  if (colorDraft) {
    return colorDraft
  }

  return selection?.textStyle ? (cssColorToHex(selection.textStyle.color) ?? '#000000') : '#000000'
}

export function useInspectorActions({
  geometry,
  onApplyOperations,
  selection,
}: UseInspectorActionsArgs) {
  const colorCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [colorDraftState, setColorDraftState] = useState<{
    elementId: string
    value: string
  } | null>(null)
  const selectionElementId = selection?.elementId ?? null
  const colorDraft =
    colorDraftState && colorDraftState.elementId === selectionElementId
      ? colorDraftState.value
      : null

  useEffect(() => {
    return () => {
      if (colorCommitTimerRef.current !== null) {
        clearTimeout(colorCommitTimerRef.current)
        colorCommitTimerRef.current = null
      }
    }
  }, [selectionElementId])

  const apply = (operations: DeckElementPatchOperation[], summary: string) => {
    applyInspectorOperations(onApplyOperations, operations, summary)
  }

  const commitGeometryField = (field: InspectorGeometryField, raw: string, summary: string) => {
    if (!selection || !geometry) return
    const normalized = parsePercentInput(raw)
    if (normalized === null) return
    const operation = buildGeometryFieldOperation(selection, geometry, field, normalized)
    if (operation) apply([operation], summary)
  }

  const commitStyle = (style: Record<string, string>, summary: string) => {
    if (!selection) return
    apply([buildInlineStyleOperation(selection, style)], summary)
  }

  const commitColor = (hex: string) => {
    if (!selection) return
    setColorDraftState({ elementId: selection.elementId, value: hex })
    if (colorCommitTimerRef.current !== null) {
      clearTimeout(colorCommitTimerRef.current)
    }
    colorCommitTimerRef.current = setTimeout(() => {
      colorCommitTimerRef.current = null
      commitStyle({ color: hex }, 'Updated text color')
    }, COLOR_COMMIT_DEBOUNCE_MS)
  }

  const commitFontSize = (raw: string) => {
    const clamped = parseClampedPxInput(raw, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
    if (clamped === null) return
    commitStyle({ 'font-size': `${clamped}px` }, 'Updated font size')
  }

  const commitLineHeight = (raw: string) => {
    const clamped = parseClampedPxInput(raw, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max)
    if (clamped === null) return
    commitStyle({ 'line-height': `${clamped}px` }, 'Updated line height')
  }

  const commitImageFit = (fit: ImageFitMode) => {
    if (!selection) return
    apply(buildImageFitOperations(selection, fit), 'Updated image fit mode')
  }

  const commitReorder = (direction: 'front' | 'back') => {
    if (!selection) return
    apply([buildReorderElementOperation(selection, direction)], reorderElementSummary(direction))
  }

  const commitLockToggle = () => {
    if (!selection) return
    apply([buildLockToggleOperation(selection)], lockToggleSummary(selection.locked))
  }

  const commitAlt = (alt: string) => {
    if (!selection) return
    apply([buildAttrsOperation(selection, { alt })], 'Updated image alt text')
  }

  return {
    colorValue: colorValueForSelection(selection, colorDraft),
    commitAlt,
    commitColor,
    commitFontSize,
    commitGeometryField,
    commitImageFit,
    commitLineHeight,
    commitLockToggle,
    commitReorder,
    commitStyle,
  }
}
