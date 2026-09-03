import './constants.ts'
import { prepareMove, settleSlideRelativePosition } from './adopt.ts'
import {
  clearGuides,
  clearMarquee,
  isSelectionUnsafe,
  postSelection,
  refreshSelectionChrome,
  setSelectedElement,
} from './chrome.ts'
import { getSlideLogicalHeight, getSlideLogicalWidth, normalizeRect } from './geometry.ts'
import { cancelTransformRaf } from './pointer.ts'
import { postError, postToParent } from './port.ts'
import { getActiveSlide, isEditableCandidate, resolveElementId } from './selection.ts'
import { runtime } from './state.ts'
import { endTextEdit } from './text-edit.ts'
import {
  applyGroupMove,
  applyTransform,
  commitGroupMove,
  restoreTransformMembers,
} from './transform.ts'

export function finishNudge() {
  if (!runtime.nudgeState) {
    return
  }

  window.clearTimeout(runtime.nudgeState!.timer ?? undefined)
  var slide = getActiveSlide()!

  if (slide && runtime.nudgeState!.element) {
    if (runtime.nudgeState!.members && runtime.nudgeState!.members.length > 1) {
      var pending = runtime.transformState
      runtime.transformState = {
        kind: 'move',
        element: runtime.nudgeState!.element,
        members: runtime.nudgeState!.members,
        startGeometry: runtime.nudgeState!.startGeometry || runtime.nudgeState!.geometry,
        adopted: runtime.nudgeState!.adopted,
        positionContext: runtime.nudgeState!.positionContext,
        cache: runtime.nudgeState!.cache,
        lastGeometry: runtime.nudgeState!.geometry,
      }
      commitGroupMove(runtime.transformState, slide)
      runtime.transformState = pending
    } else {
      applyTransform(
        runtime.nudgeState!.element,
        slide,
        runtime.nudgeState!.geometry || normalizeRect(runtime.nudgeState!.element, slide),
        false,
        'move',
        runtime.nudgeState!.adopted,
        runtime.nudgeState!.positionContext,
        runtime.nudgeState!.cache,
      )
    }
  }

  runtime.nudgeState = null
}

export function cancelNudge(slide: HTMLElement) {
  if (!runtime.nudgeState) {
    return false
  }

  var state = runtime.nudgeState
  runtime.nudgeState = null
  window.clearTimeout(state.timer ?? undefined)
  restoreTransformMembers(state)
  clearGuides()
  postToParent({ type: C.TRANSFORM_CANCEL })

  if (slide) {
    refreshSelectionChrome(runtime.selectedElement, slide, runtime.currentSlideIndex)
  }

  return true
}

export function nudgeSelection(event: KeyboardEvent, slide: HTMLElement) {
  if (!runtime.selectedElement || runtime.selectedElement!.getAttribute(C.LOCKED_ATTR) === 'true') {
    return false
  }

  if (isSelectionUnsafe()) {
    postError(
      'Move, nudge, and delete need every selected element to be unlocked and not nested.',
      'mixed-selection',
    )
    return false
  }

  if (!runtime.nudgeState || runtime.nudgeState!.element !== runtime.selectedElement) {
    finishNudge()
    // Keyboard nudges adopt immediately (one discrete reflow). Pointer drags
    // defer adoption and use transform previews instead.
    var prepared = prepareMove(runtime.selectedElement, slide, true)
    var members = []

    if (runtime.selectedElements.length > 1) {
      for (var ni = 0; ni < runtime.selectedElements.length; ni++) {
        var memberPrepared =
          runtime.selectedElements[ni] === runtime.selectedElement
            ? prepared
            : prepareMove(runtime.selectedElements[ni], slide, true)
        members.push({
          element: runtime.selectedElements[ni],
          startGeometry: memberPrepared.geometry,
          snapshot: memberPrepared.snapshot,
          adopted: memberPrepared.adopted,
          logicalWidth: memberPrepared.logicalWidth,
          positionContext: memberPrepared.positionContext,
          cache: memberPrepared.cache,
          lastGeometry: memberPrepared.geometry,
        })
      }
    }

    runtime.nudgeState = {
      element: runtime.selectedElement,
      adopted: prepared.adopted,
      geometry: prepared.geometry,
      startGeometry: prepared.geometry,
      snapshot: prepared.snapshot,
      positionContext: prepared.positionContext,
      cache: prepared.cache,
      members: members,
      timer: null,
    }
  }

  var geometry = {
    x: runtime.nudgeState!.geometry.x,
    y: runtime.nudgeState!.geometry.y,
    width: runtime.nudgeState!.geometry.width,
    height: runtime.nudgeState!.geometry.height,
  }
  var slideWidth = runtime.nudgeState!.cache.logicalSlideWidth || getSlideLogicalWidth(slide)
  var slideHeight = runtime.nudgeState!.cache.logicalSlideHeight || getSlideLogicalHeight(slide)
  var amount = event.shiftKey ? 10 : 1

  if (event.key === 'ArrowLeft') geometry.x -= amount / slideWidth
  if (event.key === 'ArrowRight') geometry.x += amount / slideWidth
  if (event.key === 'ArrowUp') geometry.y -= amount / slideHeight
  if (event.key === 'ArrowDown') geometry.y += amount / slideHeight

  if (runtime.nudgeState!.members && runtime.nudgeState!.members.length > 1) {
    runtime.nudgeState!.geometry = applyGroupMove(
      {
        element: runtime.nudgeState!.element,
        members: runtime.nudgeState!.members,
        startGeometry: runtime.nudgeState!.startGeometry,
        adopted: runtime.nudgeState!.adopted,
        positionContext: runtime.nudgeState!.positionContext,
        cache: runtime.nudgeState!.cache,
      },
      slide,
      geometry,
      true,
    )
  } else {
    runtime.nudgeState!.geometry = applyTransform(
      runtime.selectedElement,
      slide,
      geometry,
      true,
      'move',
      runtime.nudgeState!.adopted,
      runtime.nudgeState!.positionContext,
      runtime.nudgeState!.cache,
    )
  }
  if (runtime.nudgeState!.adopted && !runtime.nudgeState!.layoutCorrectionScheduled) {
    runtime.nudgeState!.layoutCorrectionScheduled = true
    var pendingNudgeState = runtime.nudgeState
    window.requestAnimationFrame(function () {
      if (runtime.nudgeState !== pendingNudgeState || !pendingNudgeState.geometry) {
        return
      }

      // Reveal can recenter after adoption changes scrollHeight; converge CSS
      // offsets once so the live nudge matches the intended geometry.
      settleSlideRelativePosition(
        pendingNudgeState.element,
        slide,
        pendingNudgeState.geometry,
        pendingNudgeState.positionContext,
      )
      refreshSelectionChrome(pendingNudgeState.element, slide, runtime.currentSlideIndex)
    })
  }
  window.clearTimeout(runtime.nudgeState!.timer ?? undefined)
  runtime.nudgeState!.timer = window.setTimeout(finishNudge, 400)
  return true
}

export function cancelTransform(slide: HTMLElement | null) {
  if (!runtime.transformState) {
    return false
  }

  cancelTransformRaf()
  restoreTransformMembers(runtime.transformState)
  runtime.transformState = null
  clearMarquee()
  clearGuides()
  postToParent({ type: C.TRANSFORM_CANCEL })
  refreshSelectionChrome(runtime.selectedElement, slide, runtime.currentSlideIndex)
  return true
}

export function selectParent(slide: HTMLElement) {
  var parent = runtime.selectedElement ? runtime.selectedElement!.parentElement : null

  while (parent && parent !== slide && !isEditableCandidate(parent, slide)) {
    parent = parent.parentElement
  }

  var next = parent && parent !== slide ? parent : null
  setSelectedElement(next, slide, runtime.currentSlideIndex)
  postSelection(next, slide, runtime.currentSlideIndex)
}

export function onKeyDown(event: KeyboardEvent) {
  if (runtime.textEditElement) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      endTextEdit(false)
      return
    }

    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.stopPropagation()
    }

    return
  }

  if (!runtime.enabled || runtime.currentTool !== 'select') {
    return
  }

  var shortcutKey = event.key.toLowerCase()

  if (event.metaKey || event.ctrlKey) {
    var action = null

    if (shortcutKey === 'z') action = event.shiftKey ? 'redo' : 'undo'
    if (shortcutKey === 'y') action = 'redo'
    if (shortcutKey === 'd' && runtime.selectedElement) action = 'duplicate'

    if (action) {
      event.preventDefault()
      event.stopPropagation()

      if (action === 'undo' && cancelNudge(getActiveSlide()!)) {
        return
      }

      finishNudge()
      postToParent({ type: C.SHORTCUT, action: action })
      return
    }
  }

  var slide = getActiveSlide()!

  if (event.key === 'Escape' && slide) {
    event.preventDefault()
    event.stopPropagation()

    if (cancelNudge(slide)) {
      return
    }

    if (!cancelTransform(slide)) {
      if (runtime.selectedElements.length > 1) {
        setSelectedElement(null, slide, runtime.currentSlideIndex)
        postSelection(null, slide, runtime.currentSlideIndex)
      } else {
        selectParent(slide)
      }
    }

    return
  }

  if (
    slide &&
    (event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown') &&
    nudgeSelection(event, slide)
  ) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if ((event.key === 'Delete' || event.key === 'Backspace') && runtime.selectedElement) {
    if (isSelectionUnsafe() || runtime.selectedElement!.getAttribute(C.LOCKED_ATTR) === 'true') {
      if (runtime.selectedElements.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        postError(
          'Move, nudge, and delete need every selected element to be unlocked and not nested.',
          'mixed-selection',
        )
      }

      return
    }

    event.preventDefault()
    event.stopPropagation()
    finishNudge()
    postToParent({
      type: C.DELETE_REQUEST,
      elementId: resolveElementId(
        runtime.selectedElement,
        getActiveSlide()!,
        runtime.currentSlideIndex,
      ),
      slideIndex: runtime.currentSlideIndex,
    })
  }
}
