import type { EditorNormalizedRect } from '@ark/deck-core/deck-editor-bridge.ts'
import { normalizedRectToStagePixels } from '@/lib/editor-overlay-geometry'
import { cn } from '@/lib/utils'

export type EditorSelectionOverlayProps = {
  geometry: EditorNormalizedRect | null
  hoverGeometry?: EditorNormalizedRect | null
  scale: number
  locked?: boolean
  isEditing?: boolean
}

export function EditorSelectionOverlay({
  geometry,
  hoverGeometry = null,
  scale,
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
          className="pointer-events-none absolute left-0 top-0 rounded-sm border border-[var(--ark-accent)]/40 bg-[var(--ark-accent-soft)]/5"
          style={normalizedRectToStagePixels(hoverGeometry, scale)}
        />
      ) : null}
      {geometry ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-0 rounded-sm border-2 transition-colors',
            locked
              ? 'border-amber-500/70 bg-amber-500/5'
              : isEditing
                ? 'border-[var(--ark-accent)] bg-[var(--ark-accent-soft)]/20'
                : 'border-[var(--ark-accent)]/80 bg-[var(--ark-accent-soft)]/10',
          )}
          style={normalizedRectToStagePixels(geometry, scale)}
        />
      ) : null}
    </>
  )
}
