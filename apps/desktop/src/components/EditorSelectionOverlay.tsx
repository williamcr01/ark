import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'

import type { EditorNormalizedRect, EditorSurface } from '@ark/editor-runtime'
import { normalizedRectToStagePixels } from '@/lib/editor/editor-overlay-geometry'
import { cn } from '@/lib/ui/utils'

export type EditorOverlayCompanion = {
  elementId: string
  geometry: EditorNormalizedRect
  slideBounds?: EditorNormalizedRect | null
  locked?: boolean
  surface?: EditorSurface
}

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
  companionGeometries?: EditorOverlayCompanion[]
}

export type EditorSelectionOverlayHandle = {
  applyTransformPreview: (
    geometry: EditorNormalizedRect,
    slideBounds?: EditorNormalizedRect | null,
  ) => void
  clearTransformPreview: () => void
}

function selectionBoxClassName(locked: boolean, surface: EditorSurface, isEditing: boolean) {
  return cn(
    'pointer-events-none absolute left-0 top-0 rounded-sm border-2 transition-colors',
    locked
      ? 'border-amber-500/70 bg-amber-500/5'
      : surface === 'dark'
        ? cn('border-white shadow-[0_0_0_1px_#000]', isEditing && 'bg-white/10')
        : cn('border-black shadow-[0_0_0_1px_#fff]', isEditing && 'bg-black/10'),
  )
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
    companionGeometries = [],
  },
  ref,
) {
  const selectionBoxRef = useRef<HTMLDivElement>(null)
  const companionRootRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  const committedGeometryRef = useRef(geometry)
  const committedSlideBoundsRef = useRef(slideBounds)
  const committedCompanionsRef = useRef(companionGeometries)
  const transformPreviewRef = useRef<{
    geometry: EditorNormalizedRect
    slideBounds?: EditorNormalizedRect | null
  } | null>(null)

  const writeNode = (
    node: HTMLElement | null,
    nextGeometry: EditorNormalizedRect | null,
    nextSlideBounds?: EditorNormalizedRect | null,
  ) => {
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

  const writeCompanions = (deltaX: number, deltaY: number) => {
    const root = companionRootRef.current

    if (!root) {
      return
    }

    const nodes = root.querySelectorAll<HTMLElement>('[data-editor-companion]')

    nodes.forEach((node, index) => {
      const companion = committedCompanionsRef.current[index]

      if (!companion) {
        return
      }

      writeNode(
        node,
        {
          ...companion.geometry,
          x: companion.geometry.x + deltaX,
          y: companion.geometry.y + deltaY,
        },
        companion.slideBounds ?? committedSlideBoundsRef.current,
      )
    })
  }

  const writeGeometry = (
    nextGeometry: EditorNormalizedRect | null,
    nextSlideBounds?: EditorNormalizedRect | null,
  ) => {
    writeNode(selectionBoxRef.current, nextGeometry, nextSlideBounds)
    const committed = committedGeometryRef.current
    const deltaX = committed && nextGeometry ? nextGeometry.x - committed.x : 0
    const deltaY = committed && nextGeometry ? nextGeometry.y - committed.y : 0
    writeCompanions(deltaX, deltaY)
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
    committedCompanionsRef.current = companionGeometries

    const preview = transformPreviewRef.current
    if (preview) {
      writeGeometry(preview.geometry, preview.slideBounds)
    }
  }, [companionGeometries, geometry, scale, slideBounds])

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
})
