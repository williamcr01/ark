import type { EditorNormalizedRect, EditorSurface } from '@ark/deck-core/deck-editor-bridge.ts'
import { normalizedRectToStagePixels } from '@/lib/editor-overlay-geometry'
import { cn } from '@/lib/utils'

export type EditorSelectionOverlayProps = {
  geometry: EditorNormalizedRect | null
  hoverGeometry?: EditorNormalizedRect | null
  slideBounds?: EditorNormalizedRect | null
  hoverSlideBounds?: EditorNormalizedRect | null
  scale: number
  surface?: EditorSurface
  hoverSurface?: EditorSurface
  locked?: boolean
  isEditing?: boolean
}

export function EditorSelectionOverlay({
  geometry,
  hoverGeometry = null,
  slideBounds = null,
  hoverSlideBounds = null,
  scale,
  surface = 'light',
  hoverSurface = 'light',
  locked = false,
  isEditing = false,
}: EditorSelectionOverlayProps) {
  if (scale <= 0) {
    return null
  }

  const showHover =
    hoverGeometry &&
    (!geometry ||
      hoverGeometry.x !== geometry.x ||
      hoverGeometry.y !== geometry.y ||
      hoverGeometry.width !== geometry.width ||
      hoverGeometry.height !== geometry.height)

  return (
    <>
      {showHover ? (
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
          className={cn(
            'pointer-events-none absolute left-0 top-0 rounded-sm border-2 transition-colors',
            locked
              ? 'border-amber-500/70 bg-amber-500/5'
              : surface === 'dark'
                ? cn('border-white shadow-[0_0_0_1px_#000]', isEditing && 'bg-white/10')
                : cn('border-black shadow-[0_0_0_1px_#fff]', isEditing && 'bg-black/10'),
          )}
          style={normalizedRectToStagePixels(geometry, scale, slideBounds ?? undefined)}
        />
      ) : null}
    </>
  )
}
