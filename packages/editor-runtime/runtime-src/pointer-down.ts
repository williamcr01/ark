import './constants.ts'
import { prepareMove } from './adopt.ts'
import {
  clearEditorOverlays,
  isSelectionMember,
  isSelectionUnsafe,
  postSelection,
  setSelectedElement,
  setSelectedElements,
  toggleSelectedElement,
} from './chrome.ts'
import {
  getSlideCoordinateRect,
  getSlideLogicalHeight,
  getSlideLogicalWidth,
  isTextEditableElement,
  pointerToNormalized,
} from './geometry.ts'
import { finishNudge } from './keyboard.ts'
import { postError, postToParent } from './port.ts'
import { findEditableTarget, getActiveSlide } from './selection.ts'
import { collectSnapRects, ensureMarquee, pointerFromCache } from './snap.ts'
import { runtime } from './state.ts'
import { findResizeHandle, isNonComposableTransform } from './transform.ts'
import { captureTransformPointer } from './pointer-flush.ts'

function startTextBoxDraw(event: PointerEvent, slide: HTMLElement) {
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
}

function startResizeFromHandle(event: PointerEvent, slide: HTMLElement, handle: string) {
  event.preventDefault()
  event.stopPropagation()
  var preparedResize = prepareMove(runtime.selectedElement!, slide, false)
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
      liveTransform: false,
    }),
    started: false,
    pendingPointer: null,
    rafId: 0,
  }
  captureTransformPointer(slide, event.pointerId)
}

function deselectOnEmptyTarget(event: PointerEvent, slide: HTMLElement) {
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
}

function applyPointerSelection(
  event: PointerEvent,
  slide: HTMLElement,
  target: HTMLElement,
  alreadySelected: boolean,
  additive: boolean,
) {
  if (additive) {
    toggleSelectedElement(target, slide, runtime.currentSlideIndex)
    postSelection(runtime.selectedElement, slide, runtime.currentSlideIndex)
    return 'stop'
  }

  if (!alreadySelected) {
    setSelectedElement(target, slide, runtime.currentSlideIndex)
    postSelection(target, slide, runtime.currentSlideIndex)
  } else if (target !== runtime.selectedElement) {
    setSelectedElements(runtime.selectedElements, target, slide, runtime.currentSlideIndex)
    postSelection(target, slide, runtime.currentSlideIndex)
  }

  return 'continue'
}

function buildMoveMembers(
  target: HTMLElement,
  slide: HTMLElement,
  prepared: ReturnType<typeof prepareMove>,
) {
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

  return members
}

function startMoveGesture(
  event: PointerEvent,
  slide: HTMLElement,
  target: HTMLElement,
  editOnClick: boolean,
) {
  var prepared = prepareMove(target, slide, false)
  var members = buildMoveMembers(target, slide, prepared)
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
    startTextBoxDraw(event, slide)
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
    startResizeFromHandle(event, slide, handle)
    return
  }

  var target = findEditableTarget(event.target, slide)

  if (!target) {
    deselectOnEmptyTarget(event, slide)
    return
  }

  event.preventDefault()
  event.stopPropagation()
  var alreadySelected = isSelectionMember(target)
  var additive = Boolean(event.shiftKey || event.metaKey || event.ctrlKey)

  if (applyPointerSelection(event, slide, target, alreadySelected, additive) === 'stop') {
    return
  }

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
    startMoveGesture(event, slide, target, editOnClick)
  }
}
