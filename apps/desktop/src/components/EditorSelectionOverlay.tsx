import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'

import type { EditorNormalizedRect, EditorSurface } from '@ark/editor-runtime'
import { normalizedRectToStagePixels } from '@/lib/editor/editor-overlay-geometry'
import { EditorSelectionOverlayBoxes } from './EditorSelectionOverlayBoxes.tsx'
import {
  writeEditorOverlayCompanions,
  writeEditorOverlayNode,
  type EditorOverlayCompanion,
} from './editor-selection-overlay-write.ts'

export type { EditorOverlayCompanion }

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

const EMPTY_COMPANIONS: EditorOverlayCompanion[] = []

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
    companionGeometries = EMPTY_COMPANIONS,
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

  const writeGeometry = (
    nextGeometry: EditorNormalizedRect | null,
    nextSlideBounds?: EditorNormalizedRect | null,
  ) => {
    writeEditorOverlayNode(selectionBoxRef.current, nextGeometry, scaleRef.current, nextSlideBounds)
    writeEditorOverlayCompanions(
      companionRootRef.current,
      committedCompanionsRef.current,
      scaleRef.current,
      committedGeometryRef.current,
      committedSlideBoundsRef.current,
      nextGeometry,
    )
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
    <EditorSelectionOverlayBoxes
      companionGeometries={companionGeometries}
      companionRootRef={companionRootRef}
      geometry={geometry}
      hoverGeometry={hoverGeometry}
      hoverSlideBounds={hoverSlideBounds}
      hoverSurface={hoverSurface}
      isEditing={isEditing}
      locked={locked}
      scale={scale}
      selectionBoxRef={selectionBoxRef}
      selectionStyle={selectionStyle}
      showHover={Boolean(showHover)}
      slideBounds={slideBounds}
      surface={surface}
    />
  )
})
