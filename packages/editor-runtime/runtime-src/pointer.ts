import './constants.ts'
import { clearEditorOverlays, clearGuides, clearMarquee, setHoverCursor } from './chrome.ts'
import { getTextEditTarget, isTextBox, normalizeRect, normalizeSlideBounds } from './geometry.ts'
import { cancelTransform } from './keyboard.ts'
import { postToParent } from './port.ts'
import {
  getActiveSlide,
  isEditableCandidate,
  isTextEditableTag,
  resolveElementId,
} from './selection.ts'
import { finishTextBoxDraw, pointerFromCache } from './snap.ts'
import { runtime } from './state.ts'
import { detectSurface } from './surface.ts'
import { startTextEditOnElement } from './text-edit.ts'
import { commitGroupMove, restoreTransformMembers } from './transform.ts'
import type { PendingPointer } from './types.ts'
import {
  cancelTransformRaf,
  flushTransformPointer,
  scheduleTransformFlush,
} from './pointer-flush.ts'

export {
  cancelTransformRaf,
  captureTransformPointer,
  flushTransformPointer,
  scheduleTransformFlush,
} from './pointer-flush.ts'
export { onPointerDown } from './pointer-down.ts'

export function flushHover() {
  runtime.hoverRafId = 0
  var hover = runtime.pendingHover
  runtime.pendingHover = null

  if (!hover || !runtime.enabled || runtime.textEditElement || runtime.transformState) {
    return
  }

  var slide = getActiveSlide()!

  if (!slide) {
    return
  }

  var target = findEditableTarget(hover.eventTarget, slide)

  if (!setHoverCursor(target)) {
    return
  }

  postToParent({
    type: C.HOVER,
    slideIndex: runtime.currentSlideIndex,
    elementId: target ? resolveElementId(target, slide, runtime.currentSlideIndex) : null,
    geometry: target ? normalizeRect(target, slide) : undefined,
    slideBounds: target ? normalizeSlideBounds(slide) : undefined,
    surface: target ? detectSurface(target, slide) : undefined,
  })
}

export function onPointerMove(event: PointerEvent) {
  if (!runtime.enabled || runtime.textEditElement) {
    return
  }

  var slide = getActiveSlide()!

  if (!slide) {
    return
  }

  if (runtime.transformState && runtime.transformState!.pointerId === event.pointerId) {
    runtime.transformState!.pendingPointer = {
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    }
    scheduleTransformFlush(slide)
    return
  }

  if (runtime.transformState) {
    return
  }

  runtime.pendingHover = { eventTarget: event.target }

  if (!runtime.hoverRafId) {
    runtime.hoverRafId = window.requestAnimationFrame(flushHover)
  }
}
export function finishTransform(slide: HTMLElement | null, pointer: PendingPointer | null) {
  if (!runtime.transformState) {
    return false
  }

  cancelTransformRaf()
  var lastPointer = pointer || runtime.transformState!.pendingPointer

  // Flush needs a live slide (showGuide → getSlideCoordinateElement). Restore
  // the snapshot when the slide is gone instead of flushing into null.
  if (!slide) {
    restoreTransformMembers(runtime.transformState)
    runtime.transformState = null
    clearEditorOverlays()
    postToParent({ type: C.TRANSFORM_CANCEL })
    return true
  }

  if (pointer) {
    runtime.transformState!.pendingPointer = pointer
    flushTransformPointer(slide)
  } else if (runtime.transformState!.pendingPointer) {
    flushTransformPointer(slide)
  }

  if (runtime.transformState!.kind === 'draw') {
    // Outside release without a tracked pointer has no meaningful end point —
    // discard the marquee rather than inserting a default-size box.
    if (!lastPointer) {
      clearMarquee()
      runtime.transformState = null
      return true
    }

    var endPoint = pointerFromCache(
      lastPointer.clientX,
      lastPointer.clientY,
      runtime.transformState!.cache,
      slide,
    )
    finishTextBoxDraw(slide, runtime.transformState!.startPoint!, endPoint)
    clearMarquee()
    runtime.transformState = null
    return true
  }

  if (
    (runtime.transformState!.kind === 'move' || runtime.transformState!.kind === 'resize') &&
    runtime.transformState!.element
  ) {
    if (!runtime.transformState!.started) {
      var editOnClick =
        runtime.transformState!.kind === 'move' && runtime.transformState!.editOnClick
      var clickedElement = runtime.transformState!.element
      runtime.transformState = null

      if (editOnClick) {
        startTextEditOnElement(clickedElement, slide, runtime.currentSlideIndex)
      }

      return true
    }

    var finalGeometry =
      runtime.transformState!.lastGeometry || normalizeRect(runtime.transformState!.element, slide)
    runtime.transformState!.lastGeometry = finalGeometry

    // Always emit a commit (even for a no-op drag) so the shell clears
    // transformPreview / isTransformingRef; empty patch ops are a no-op.
    if (
      runtime.transformState!.kind === 'move' &&
      runtime.transformState!.members &&
      runtime.transformState!.members.length > 1
    ) {
      commitGroupMove(runtime.transformState, slide)
    } else {
      applyTransform(
        runtime.transformState!.element,
        slide,
        finalGeometry,
        false,
        runtime.transformState!.kind,
        runtime.transformState!.adopted,
        runtime.transformState!.positionContext,
        runtime.transformState!.cache,
      )
    }
    clearGuides()
    runtime.transformState = null
    return true
  }

  runtime.transformState = null
  return true
}

export function onPointerUp(event: PointerEvent) {
  if (
    !runtime.enabled ||
    !runtime.transformState ||
    runtime.transformState!.pointerId !== event.pointerId
  ) {
    return
  }

  finishTransform(getActiveSlide()!, {
    clientX: event.clientX,
    clientY: event.clientY,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  })
}

export function onPointerCancel(event: PointerEvent) {
  if (!runtime.transformState || runtime.transformState!.pointerId !== event.pointerId) {
    return
  }

  var slide = getActiveSlide()!

  if (slide) {
    cancelTransform(slide)
    return
  }

  cancelTransformRaf()
  restoreTransformMembers(runtime.transformState)
  runtime.transformState = null
  clearEditorOverlays()
  postToParent({ type: C.TRANSFORM_CANCEL })
}

export function onLostPointerCapture(event: PointerEvent) {
  if (!runtime.transformState || runtime.transformState!.pointerId !== event.pointerId) {
    return
  }

  // Crossing a sandboxed iframe boundary can drop capture. If the gesture
  // already moved, treat that as commit; otherwise cancel like a click.
  if (runtime.transformState!.started) {
    finishTransform(getActiveSlide()!, null)
    return
  }

  onPointerCancel(event)
}

export function onDoubleClick(event: MouseEvent) {
  if (!runtime.enabled || runtime.textEditElement) {
    return
  }

  var slide = getActiveSlide()!

  if (!slide) {
    return
  }

  var target = findEditableTarget(event.target, slide)

  if (!target) {
    return
  }

  var directTarget = event.target as HTMLElement | null

  if (
    !isTextBox(target) &&
    directTarget &&
    directTarget.nodeType === 1 &&
    isEditableCandidate(directTarget, slide)
  ) {
    target = directTarget
  }

  var editableTarget = getTextEditTarget(target)
  var tag = editableTarget ? editableTarget.tagName.toLowerCase() : ''

  if (!editableTarget || (!isTextEditableTag(tag) && !isTextBox(target))) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  setSelectedElement(target, slide, runtime.currentSlideIndex)
  postSelection(target, slide, runtime.currentSlideIndex)
  startTextEditOnElement(target, slide, runtime.currentSlideIndex)
}
