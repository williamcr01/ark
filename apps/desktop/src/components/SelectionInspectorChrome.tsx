import { useMemo, useState } from 'react'
import { SlidersHorizontalIcon } from 'lucide-react'

import { ElementInspector } from '@/components/ElementInspector'
import { normalizedRectToStagePixels } from '@/lib/editor/editor-overlay-geometry'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PREVIEW_FRAME_HEIGHT, PREVIEW_FRAME_WIDTH } from '@/lib/deck/deck-preview'
import { cn } from '@/lib/ui/utils'
import type { EditorNormalizedRect, EditorSelectionInfo } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'

const SETTINGS_BUTTON_SIZE = 28
const SETTINGS_BUTTON_GAP = 4

export type SelectionInspectorChromeProps = {
  selection: EditorSelectionInfo | null
  geometry: EditorNormalizedRect | null
  /** Viewport-normalized slide box for positioning the settings trigger. */
  slideBounds?: EditorNormalizedRect | null
  zIndex: number | null
  scale: number
  textEditActive: boolean
  isSaving: boolean
  /** Hide the trigger while a live transform preview is in flight. */
  transforming?: boolean
  onApplyOperations?: (operations: DeckElementPatchOperation[], summary: string) => void
}

function clampSettingsButtonPosition(
  box: { left: number; top: number; width: number; height: number },
  scale: number,
): { left: number; top: number } {
  const stageWidth = PREVIEW_FRAME_WIDTH * scale
  const stageHeight = PREVIEW_FRAME_HEIGHT * scale

  let left = box.left + box.width + SETTINGS_BUTTON_GAP
  let top = box.top

  if (left + SETTINGS_BUTTON_SIZE > stageWidth) {
    left = box.left - SETTINGS_BUTTON_SIZE - SETTINGS_BUTTON_GAP
  }

  if (left < 0) {
    left = Math.max(
      0,
      Math.min(box.left + box.width - SETTINGS_BUTTON_SIZE, stageWidth - SETTINGS_BUTTON_SIZE),
    )
  }

  if (top + SETTINGS_BUTTON_SIZE > stageHeight) {
    top = stageHeight - SETTINGS_BUTTON_SIZE
  }

  if (top < 0) {
    top = 0
  }

  return { left, top }
}

export function SelectionInspectorChrome({
  selection,
  geometry,
  slideBounds = null,
  zIndex,
  scale,
  textEditActive,
  isSaving,
  transforming = false,
  onApplyOperations,
}: SelectionInspectorChromeProps) {
  const selectionKey = selection ? `${selection.elementId}:${selection.slideIndex}` : null
  // Open state is keyed to the selection so changing/clearing selection closes
  // the panel without an effect-driven setState.
  const [openSelectionKey, setOpenSelectionKey] = useState<string | null>(null)

  const buttonPosition = useMemo(() => {
    if (!geometry || scale <= 0) {
      return null
    }

    return clampSettingsButtonPosition(
      normalizedRectToStagePixels(geometry, scale, slideBounds ?? undefined),
      scale,
    )
  }, [geometry, scale, slideBounds])

  const triggerVisible =
    Boolean(selection && geometry && buttonPosition && scale > 0) &&
    !textEditActive &&
    !transforming

  const open = triggerVisible && openSelectionKey !== null && openSelectionKey === selectionKey

  if (!triggerVisible || !buttonPosition || !selection || !geometry) {
    return null
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpenSelectionKey(nextOpen && selectionKey ? selectionKey : null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label="Element settings"
          className={cn(
            'pointer-events-auto absolute z-20 inline-flex items-center justify-center rounded-md border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] text-[var(--ark-titlebar-fg)] shadow-sm transition-colors',
            'hover:bg-[var(--ark-titlebar-hover)] outline-none',
            open && 'bg-[var(--ark-fill-soft)] text-[var(--ark-accent)]',
          )}
          style={{
            left: buttonPosition.left,
            top: buttonPosition.top,
            width: SETTINGS_BUTTON_SIZE,
            height: SETTINGS_BUTTON_SIZE,
          }}
          type="button"
        >
          <SlidersHorizontalIcon aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Element inspector"
        className="w-auto border-0 bg-transparent p-0 shadow-none ring-0"
        collisionPadding={8}
        side="right"
        sideOffset={8}
      >
        <ElementInspector
          geometry={geometry}
          isSaving={isSaving}
          onApplyOperations={onApplyOperations}
          selection={selection}
          textEditActive={textEditActive}
          zIndex={zIndex}
        />
      </PopoverContent>
    </Popover>
  )
}
