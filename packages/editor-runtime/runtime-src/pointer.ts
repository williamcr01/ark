import './constants.ts'
import { adoptMove, prepareMove } from './adopt.ts'
import {
  clearEditorOverlays,
  clearGuides,
  clearMarquee,
  isSelectionMember,
  isSelectionUnsafe,
  postSelection,
  setHoverCursor,
  setSelectedElement,
  setSelectedElements,
  toggleSelectedElement,
} from './chrome.ts'
import {
  getSlideCoordinateRect,
  getSlideLogicalHeight,
  getSlideLogicalWidth,
  getTextEditTarget,
  isTextBox,
  isTextEditableElement,
  normalizeRect,
  normalizeSlideBounds,
  pointerToNormalized,
} from './geometry.ts'
import { cancelTransform, finishNudge } from './keyboard.ts'
import { postError, postToParent } from './port.ts'
import {
  findEditableTarget,
  getActiveSlide,
  isEditableCandidate,
  isTextEditableTag,
  resolveElementId,
} from './selection.ts'
import {
  applySnapGuides,
  collectSnapRects,
  ensureMarquee,
  finishTextBoxDraw,
  pointerFromCache,
  snapMoveRect,
  updateMarquee,
} from './snap.ts'
import { runtime } from './state.ts'
import { detectSurface } from './surface.ts'
import { startTextEditOnElement } from './text-edit.ts'
import {
  applyGroupMove,
  applyTransform,
  commitGroupMove,
  findResizeHandle,
  isNonComposableTransform,
  resizeRectWithHandle,
  restoreTransformMembers,
} from './transform.ts'
import type { PendingPointer } from './types.ts'

export function cancelTransformRaf() {
  if (!runtime.transformState || !runtime.transformState!.rafId) {
    return
  }

  window.cancelAnimationFrame(runtime.transformState!.rafId)
  runtime.transformState!.rafId = 0
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
    updateMarquee(
      runtime.transformState!.startPoint!,
      pointerFromCache(pointer.clientX, pointer.clientY, cache, slide),
      slide,
    )
    return
  }

  if (runtime.transformState!.kind === 'move' && runtime.transformState!.element) {
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

      // Authored-transform moves use the left/top preview path, so adopt at
      // the drag threshold to freeze width before absolute positioning.
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
        runtime.transformState,
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
    return
  }

  if (
    runtime.transformState!.kind === 'resize' &&
    runtime.transformState!.element &&
    runtime.transformState!.handle
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
}

export function scheduleTransformFlush(slide: HTMLElement) {
  if (!runtime.transformState || runtime.transformState!.rafId) {
    return
  }

  var pending = runtime.transformState
  runtime.transformState!.rafId = window.requestAnimationFrame(function () {
    if (runtime.transformState !== pending) {
      return
    }

    flushTransformPointer(slide)
  })
}

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

export function onPointerDown(event: PointerEvent) {
  if (!runtime.enabled || runtime.textEditElement) {
    return
  }

  var slide = getActiveSlide()!

  if (!slide) {
    return
  }

  finishNudge()

  if (runtime.currentTool === 'text') {
    event.preventDefault()
    event.stopPropagation()
    clearEditorOverlays()
    setSelectedElement(null, slide, runtime.currentSlideIndex)
    postSelection(null, slide, runtime.currentSlideIndex)
    runtime.transformState = {
      kind: 'draw',
      pointerId: event.pointerId,
      startPoint: pointerToNormalized(event.clientX, event.clientY, slide),
      cache: {
        slideRect: getSlideCoordinateRect(slide),
        logicalSlideWidth: getSlideLogicalWidth(slide),
        logicalSlideHeight: getSlideLogicalHeight(slide),
      },
      pendingPointer: null,
      rafId: 0,
    }
    captureTransformPointer(slide, event.pointerId)
    ensureMarquee(slide)
    return
  }

  if (runtime.currentTool !== 'select') {
    return
  }

  var handle = findResizeHandle(event.target)

  if (
    handle &&
    runtime.selectedElement &&
    runtime.selectedElements.length === 1 &&
    runtime.selectedElement!.getAttribute(C.LOCKED_ATTR) !== 'true'
  ) {
    event.preventDefault()
    event.stopPropagation()
    // Defer adoption until the pointer moves past the click threshold so a
    // press-and-release on a handle does not persist position:absolute.
    var preparedResize = prepareMove(runtime.selectedElement, slide, false)
    runtime.transformState = {
      kind: 'resize',
      pointerId: event.pointerId,
      handle: handle,
      element: runtime.selectedElement,
      startPoint: pointerFromCache(event.clientX, event.clientY, preparedResize.cache, slide),
      startGeometry: preparedResize.geometry,
      snapshot: preparedResize.snapshot,
      adopted: preparedResize.adopted,
      logicalWidth: preparedResize.logicalWidth,
      positionContext: preparedResize.positionContext,
      cache: Object.assign(preparedResize.cache, {
        // Resize writes left/top/width; never use compositor translate preview.
        liveTransform: false,
      }),
      started: false,
      pendingPointer: null,
      rafId: 0,
    }
    captureTransformPointer(slide, event.pointerId)
    return
  }

  var target = findEditableTarget(event.target, slide)

  if (!target) {
    // Empty slide / non-editable chrome: deselect like PowerPoint.
    // Modifier+empty keeps the current set (additive select is a no-op).
    event.preventDefault()
    event.stopPropagation()

    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
      setSelectedElement(null, slide, runtime.currentSlideIndex)
      postSelection(null, slide, runtime.currentSlideIndex)
    }

    postToParent({
      type: C.HOVER,
      slideIndex: runtime.currentSlideIndex,
      elementId: null,
    })
    return
  }

  event.preventDefault()
  event.stopPropagation()
  var alreadySelected = isSelectionMember(target)
  var additive = Boolean(event.shiftKey || event.metaKey || event.ctrlKey)

  if (additive) {
    toggleSelectedElement(target, slide, runtime.currentSlideIndex)
    postSelection(runtime.selectedElement, slide, runtime.currentSlideIndex)
    return
  }

  if (!alreadySelected) {
    setSelectedElement(target, slide, runtime.currentSlideIndex)
    postSelection(target, slide, runtime.currentSlideIndex)
  } else if (target !== runtime.selectedElement) {
    setSelectedElements(runtime.selectedElements, target, slide, runtime.currentSlideIndex)
    postSelection(target, slide, runtime.currentSlideIndex)
  }

  // Re-click of an already-selected text element (N === 1) enters edit on
  // pointerup if the pointer never dragged. Must be computed before this
  // click's select, or the first press would start editing immediately.
  var editOnClick =
    alreadySelected && runtime.selectedElements.length === 1 && isTextEditableElement(target)

  if (isSelectionUnsafe()) {
    if (runtime.selectedElements.length > 1) {
      postError(
        'Move, nudge, and delete need every selected element to be unlocked and not nested.',
        'mixed-selection',
      )
    }

    return
  }

  if (target.getAttribute(C.LOCKED_ATTR) !== 'true') {
    var prepared = prepareMove(target, slide, false)
    var members = []

    if (runtime.selectedElements.length > 1) {
      for (var si = 0; si < runtime.selectedElements.length; si++) {
        var memberPrepared =
          runtime.selectedElements[si] === target
            ? {
                geometry: prepared.geometry,
                snapshot: prepared.snapshot,
                adopted: prepared.adopted,
                logicalWidth: prepared.logicalWidth,
                positionContext: prepared.positionContext,
                cache: prepared.cache,
              }
            : prepareMove(runtime.selectedElements[si], slide, false)
        members.push({
          element: runtime.selectedElements[si],
          startGeometry: memberPrepared.geometry,
          snapshot: memberPrepared.snapshot,
          adopted: memberPrepared.adopted,
          logicalWidth: memberPrepared.logicalWidth,
          positionContext: memberPrepared.positionContext,
          cache: Object.assign({}, memberPrepared.cache, {
            liveTransform:
              !memberPrepared.cache.authoredTransform ||
              Boolean(
                memberPrepared.cache.liveTransformBase &&
                !isNonComposableTransform(memberPrepared.cache.liveTransformBase),
              ),
            startGeometry: memberPrepared.geometry,
          }),
          lastGeometry: memberPrepared.geometry,
        })
      }
    }

    runtime.transformState = {
      kind: 'move',
      pointerId: event.pointerId,
      element: target,
      members: members,
      startPoint: pointerFromCache(event.clientX, event.clientY, prepared.cache, slide),
      startGeometry: prepared.geometry,
      snapshot: prepared.snapshot,
      adopted: prepared.adopted,
      logicalWidth: prepared.logicalWidth,
      positionContext: prepared.positionContext,
      cache: Object.assign(prepared.cache, {
        // Use compositor previews unless a stylesheet-authored transform
        // cannot be safely composed through an inline translate. Inline
        // transforms (including the CSS none keyword) are restored/composed by the cache.
        liveTransform:
          !prepared.cache.authoredTransform ||
          Boolean(
            prepared.cache.liveTransformBase &&
            !isNonComposableTransform(prepared.cache.liveTransformBase),
          ),
      }),
      started: false,
      snapRects: collectSnapRects(
        slide,
        runtime.selectedElements.length ? runtime.selectedElements : target,
      ),
      editOnClick: editOnClick,
      pendingPointer: null,
      rafId: 0,
    }
    captureTransformPointer(slide, event.pointerId)
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
