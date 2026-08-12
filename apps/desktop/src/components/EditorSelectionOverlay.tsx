import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'

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

export type EditorSelectionOverlayHandle = {
  applyTransformPreview: (
    geometry: EditorNormalizedRect,
    slideBounds?: EditorNormalizedRect | null,
  ) => void
  clearTransformPreview: () => void
}

export const EditorSelectionOverlay = forwardRef<
  EditorSelectionOverlayHandle,
  EditorSelectionOverlayProps
>(function EditorSelectionOverlay(
  {
    geometry,
    hoverGeometry = null,
    slideBounds = null,
    hoverSlideBounds = null,
    scale,
    surface = 'light',
    hoverSurface = 'light',
    locked = false,
    isEditing = false,
  },
  ref,
) {
  const selectionBoxRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  const committedGeometryRef = useRef(geometry)
  const committedSlideBoundsRef = useRef(slideBounds)
  const transformPreviewRef = useRef<{
    geometry: EditorNormalizedRect
    slideBounds?: EditorNormalizedRect | null
  } | null>(null)
  const writeGeometry = (
    nextGeometry: EditorNormalizedRect | null,
    nextSlideBounds?: EditorNormalizedRect | null,
  ) => {
    const node = selectionBoxRef.current

    if (!node || !nextGeometry || scaleRef.current <= 0) {
      return
    }

    const rect = normalizedRectToStagePixels(
      nextGeometry,
      scaleRef.current,
      nextSlideBounds ?? undefined,
    )
    node.style.left = `${rect.left}px`
    node.style.top = `${rect.top}px`
    node.style.width = `${rect.width}px`
    node.style.height = `${rect.height}px`
  }

  useImperativeHandle(
    ref,
    () => ({
      applyTransformPreview(nextGeometry, nextSlideBounds) {
        transformPreviewRef.current = { geometry: nextGeometry, slideBounds: nextSlideBounds }
        writeGeometry(nextGeometry, nextSlideBounds)
      },
      clearTransformPreview() {
        transformPreviewRef.current = null
        writeGeometry(committedGeometryRef.current, committedSlideBoundsRef.current)
      },
    }),
    [],
  )

  // Keep refs in sync before the parent can issue another imperative preview
  // command, then restore an active preview after React reasserts committed style.
  useLayoutEffect(() => {
    scaleRef.current = scale
    committedGeometryRef.current = geometry
    committedSlideBoundsRef.current = slideBounds

    const preview = transformPreviewRef.current
    if (preview) {
      writeGeometry(preview.geometry, preview.slideBounds)
    }
  }, [geometry, scale, slideBounds])

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

  const selectionStyle = geometry
    ? normalizedRectToStagePixels(geometry, scale, slideBounds ?? undefined)
    : undefined

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
          ref={selectionBoxRef}
          style={selectionStyle}
        />
      ) : null}
    </>
  )
})
