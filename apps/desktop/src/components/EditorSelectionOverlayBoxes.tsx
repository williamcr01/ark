import type { RefObject } from 'react'

import type { EditorNormalizedRect, EditorSurface } from '@ark/editor-runtime'
import { normalizedRectToStagePixels } from '@/lib/editor/editor-overlay-geometry'
import { cn } from '@/lib/ui/utils'

import {
  selectionBoxClassName,
  type EditorOverlayCompanion,
} from './editor-selection-overlay-write.ts'

export function EditorSelectionOverlayBoxes({
  companionGeometries,
  companionRootRef,
  geometry,
  hoverGeometry,
  hoverSlideBounds,
  hoverSurface,
  isEditing,
  locked,
  scale,
  selectionBoxRef,
  selectionStyle,
  showHover,
  slideBounds,
  surface,
}: {
  companionGeometries: EditorOverlayCompanion[]
  companionRootRef: RefObject<HTMLDivElement | null>
  geometry: EditorNormalizedRect | null
  hoverGeometry: EditorNormalizedRect | null
  hoverSlideBounds: EditorNormalizedRect | null
  hoverSurface: EditorSurface
  isEditing: boolean
  locked: boolean
  scale: number
  selectionBoxRef: RefObject<HTMLDivElement | null>
  selectionStyle: ReturnType<typeof normalizedRectToStagePixels> | undefined
  showHover: boolean
  slideBounds: EditorNormalizedRect | null
  surface: EditorSurface
}) {
  return (
    <>
      {showHover && hoverGeometry ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-0 rounded-sm border',
            hoverSurface === 'dark'
              ? 'border-white/60 shadow-[0_0_0_1px_#000]'
              : 'border-black/60 shadow-[0_0_0_1px_#fff]',
          )}
          style={normalizedRectToStagePixels(hoverGeometry, scale, hoverSlideBounds ?? undefined)}
        />
      ) : null}
      {geometry ? (
        <div
          aria-hidden
          className={selectionBoxClassName(locked, surface, isEditing)}
          data-editor-primary-selection=""
          ref={selectionBoxRef}
          style={selectionStyle}
        />
      ) : null}
      {companionGeometries.length > 0 ? (
        <div aria-hidden ref={companionRootRef}>
          {companionGeometries.map((companion) => (
            <div
              className={selectionBoxClassName(
                companion.locked ?? false,
                companion.surface ?? surface,
                false,
              )}
              data-editor-companion={companion.elementId}
              key={companion.elementId}
              style={normalizedRectToStagePixels(
                companion.geometry,
                scale,
                companion.slideBounds ?? slideBounds ?? undefined,
              )}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
