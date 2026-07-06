import type { EditorNormalizedRect } from '../../shared/deck-editor-bridge.ts'
import { PREVIEW_FRAME_HEIGHT, PREVIEW_FRAME_WIDTH } from '@/lib/deck-preview'
import { cn } from '@/lib/utils'

export type EditorSelectionOverlayProps = {
  geometry: EditorNormalizedRect | null
  hoverGeometry?: EditorNormalizedRect | null
  scale: number
  locked?: boolean
  isEditing?: boolean
}

function overlayBoxStyle(geometry: EditorNormalizedRect, scale: number) {
  const width = PREVIEW_FRAME_WIDTH * scale
  const height = PREVIEW_FRAME_HEIGHT * scale

  return {
    left: geometry.x * width,
    top: geometry.y * height,
    width: Math.max(geometry.width * width, 2),
    height: Math.max(geometry.height * height, 2),
  }
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
          style={overlayBoxStyle(hoverGeometry, scale)}
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
          style={overlayBoxStyle(geometry, scale)}
        />
      ) : null}
    </>
  )
}
