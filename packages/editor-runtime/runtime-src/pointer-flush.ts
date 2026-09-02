import './constants.ts'
import { adoptMove } from './adopt.ts'
import { applySnapGuides, pointerFromCache, snapMoveRect, updateMarquee } from './snap.ts'
import { runtime } from './state.ts'
import { applyGroupMove, applyTransform, resizeRectWithHandle } from './transform.ts'
import type { TransformCache } from './types.ts'

function flushDrawPointer(
  slide: HTMLElement,
  pointer: { clientX: number; clientY: number },
  cache: TransformCache | null,
) {
  updateMarquee(
    runtime.transformState!.startPoint!,
    pointerFromCache(pointer.clientX, pointer.clientY, cache, slide),
    slide,
  )
}

function adoptMoveMembersIfNeeded(slide: HTMLElement, cache: TransformCache | null) {
  var moveMembers =
    runtime.transformState!.members && runtime.transformState!.members.length
      ? runtime.transformState!.members
      : [
          {
            element: runtime.transformState!.element,
            adopted: runtime.transformState!.adopted,
            cache: cache,
            startGeometry: runtime.transformState!.startGeometry!,
            logicalWidth: runtime.transformState!.logicalWidth,
            positionContext: runtime.transformState!.positionContext,
          },
        ]

  for (var mi = 0; mi < moveMembers.length; mi++) {
    var moveMember = moveMembers[mi]
    if (moveMember.adopted && !(moveMember.cache && moveMember.cache.liveTransform)) {
      adoptMove(
        moveMember.element!,
        slide,
        moveMember.startGeometry!,
        moveMember.logicalWidth,
        moveMember.positionContext,
        moveMember.cache,
      )
    }
  }

  runtime.transformState!.started = true
}

function flushMovePointer(
  slide: HTMLElement,
  pointer: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean },
  cache: TransformCache | null,
) {
  var point = pointerFromCache(pointer.clientX, pointer.clientY, cache, slide)
  var deltaX = point.x - runtime.transformState!.startPoint!.x
  var deltaY = point.y - runtime.transformState!.startPoint!.y
  var constrainedAxis = null
  var slideRect = cache!.slideRect!

  if (!runtime.transformState!.started) {
    if (
      Math.abs(deltaX * slideRect.width) < 2 / runtime.editorScale &&
      Math.abs(deltaY * slideRect.height) < 2 / runtime.editorScale
    ) {
      return
    }

    adoptMoveMembersIfNeeded(slide, cache)
  }

  if (pointer.shiftKey) {
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      deltaY = 0
      constrainedAxis = 'x'
    } else {
      deltaX = 0
      constrainedAxis = 'y'
    }
  }

  var snapped = snapMoveRect(
    {
      x: runtime.transformState!.startGeometry!.x + deltaX,
      y: runtime.transformState!.startGeometry!.y + deltaY,
      width: runtime.transformState!.startGeometry!.width,
      height: runtime.transformState!.startGeometry!.height,
    },
    runtime.transformState!.snapRects || [],
    slide,
    pointer.altKey,
    constrainedAxis,
    cache,
  )

  if (runtime.transformState!.members && runtime.transformState!.members.length > 1) {
    runtime.transformState!.lastGeometry = applyGroupMove(
      runtime.transformState!,
      slide,
      snapped.rect,
      true,
    )
  } else {
    runtime.transformState!.lastGeometry = applyTransform(
      runtime.transformState!.element!,
      slide,
      snapped.rect,
      true,
      'move',
      runtime.transformState!.adopted,
      runtime.transformState!.positionContext,
      cache,
    )
  }
  applySnapGuides(slide, snapped.guides, cache)
}

function flushResizePointer(
  slide: HTMLElement,
  pointer: { clientX: number; clientY: number },
  cache: TransformCache | null,
) {
  var resizePoint = pointerFromCache(pointer.clientX, pointer.clientY, cache, slide)
  var resizeDeltaX = resizePoint.x - runtime.transformState!.startPoint!.x
  var resizeDeltaY = resizePoint.y - runtime.transformState!.startPoint!.y
  var resizeSlideRect = cache!.slideRect!

  if (!runtime.transformState!.started) {
    if (
      Math.abs(resizeDeltaX * resizeSlideRect.width) < 2 / runtime.editorScale &&
      Math.abs(resizeDeltaY * resizeSlideRect.height) < 2 / runtime.editorScale
    ) {
      return
    }

    if (runtime.transformState!.adopted) {
      adoptMove(
        runtime.transformState!.element!,
        slide,
        runtime.transformState!.startGeometry!,
        runtime.transformState!.logicalWidth,
        runtime.transformState!.positionContext,
        cache,
      )
    }

    runtime.transformState!.started = true
  }

  var resized = resizeRectWithHandle(
    runtime.transformState!.startGeometry!,
    runtime.transformState!.handle!,
    pointer,
    slide,
    runtime.transformState!.element!,
  )
  runtime.transformState!.lastGeometry = applyTransform(
    runtime.transformState!.element!,
    slide,
    resized,
    true,
    'resize',
    runtime.transformState!.adopted,
    runtime.transformState!.positionContext,
    cache,
  )
}

export function flushTransformPointer(slide: HTMLElement) {
  if (!runtime.transformState || !runtime.transformState!.pendingPointer) {
    return
  }

  var pointer = runtime.transformState!.pendingPointer!
  runtime.transformState!.pendingPointer = null
  runtime.transformState!.rafId = 0
  var cache = runtime.transformState!.cache || null

  if (runtime.transformState!.kind === 'draw') {
    flushDrawPointer(slide, pointer, cache)
    return
  }

  if (runtime.transformState!.kind === 'move' && runtime.transformState!.element) {
    flushMovePointer(
      slide,
      {
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        shiftKey: pointer.shiftKey ?? false,
        altKey: pointer.altKey ?? false,
      },
      cache,
    )
    return
  }

  if (
    runtime.transformState!.kind === 'resize' &&
    runtime.transformState!.element &&
    runtime.transformState!.handle
  ) {
    flushResizePointer(slide, pointer, cache)
  }
}

export function cancelTransformRaf() {
  if (!runtime.transformState || !runtime.transformState!.rafId) {
    return
  }

  window.cancelAnimationFrame(runtime.transformState!.rafId)
  runtime.transformState!.rafId = 0
}

export function captureTransformPointer(slide: HTMLElement, pointerId: number) {
  if (typeof slide.setPointerCapture !== 'function') {
    return
  }

  try {
    slide.setPointerCapture(pointerId)
  } catch {
    // Pointer capture can fail if the pointer ended before the handler ran.
  }
}

export function scheduleTransformFlush(slide: HTMLElement) {
  if (!runtime.transformState || runtime.transformState!.rafId) {
    return
  }

  runtime.transformState!.rafId = window.requestAnimationFrame(function () {
    flushTransformPointer(slide)
  })
}
