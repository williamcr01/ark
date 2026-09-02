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

export function selectionBoxClassName(locked: boolean, surface: EditorSurface, isEditing: boolean) {
  return cn(
    'pointer-events-none absolute left-0 top-0 rounded-sm border-2 transition-colors',
    locked
      ? 'border-amber-500/70 bg-amber-500/5'
      : surface === 'dark'
        ? cn('border-white shadow-[0_0_0_1px_#000]', isEditing && 'bg-white/10')
        : cn('border-black shadow-[0_0_0_1px_#fff]', isEditing && 'bg-black/10'),
  )
}

export function writeEditorOverlayNode(
  node: HTMLElement | null,
  nextGeometry: EditorNormalizedRect | null,
  scale: number,
  nextSlideBounds?: EditorNormalizedRect | null,
) {
  if (!node || !nextGeometry || scale <= 0) {
    return
  }

  const rect = normalizedRectToStagePixels(nextGeometry, scale, nextSlideBounds ?? undefined)
  node.style.left = `${rect.left}px`
  node.style.top = `${rect.top}px`
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
}

export function writeEditorOverlayCompanions(
  root: HTMLDivElement | null,
  companions: EditorOverlayCompanion[],
  scale: number,
  committedGeometry: EditorNormalizedRect | null,
  committedSlideBounds: EditorNormalizedRect | null,
  nextGeometry: EditorNormalizedRect | null,
) {
  if (!root) {
    return
  }

  const nodes = root.querySelectorAll<HTMLElement>('[data-editor-companion]')
  const deltaX = committedGeometry && nextGeometry ? nextGeometry.x - committedGeometry.x : 0
  const deltaY = committedGeometry && nextGeometry ? nextGeometry.y - committedGeometry.y : 0

  nodes.forEach((node, index) => {
    const companion = companions[index]

    if (!companion) {
      return
    }

    writeEditorOverlayNode(
      node,
      {
        ...companion.geometry,
        x: companion.geometry.x + deltaX,
        y: companion.geometry.y + deltaY,
      },
      scale,
      companion.slideBounds ?? committedSlideBounds,
    )
  })
}
