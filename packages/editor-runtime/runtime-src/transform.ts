import './constants.ts'
import {
  adoptMove,
  cleanupAdoptSideEffects,
  setSlideRelativePosition,
  settleSlideRelativePosition,
} from './adopt.ts'
import { refreshSelectionChrome, updateResizeHandles } from './chrome.ts'
import {
  applyImageAspectRatio,
  clampRect,
  getImageAspectRatio,
  getSlideCoordinateRect,
  getSlideLogicalHeight,
  getSlideLogicalWidth,
  isImageElement,
  normalizeRect,
  normalizeSlideBounds,
  pointerToNormalized,
  readZIndex,
} from './geometry.ts'
import { postToParent } from './port.ts'
import { resolveElementId } from './selection.ts'
import { runtime } from './state.ts'
import type {
  InlineSnapshot,
  NormalizedRect,
  NudgeState,
  PendingPointer,
  PositionContext,
  TransformCache,
  TransformState,
} from './types.ts'

export function isNonComposableTransform(value: unknown) {
  return /^(none|initial|inherit|unset|revert|revert-layer)$/i.test(String(value || '').trim())
}

export function clearLiveTransform(element: HTMLElement, cache?: TransformCache | null) {
  // Only clear transforms we applied for the gesture preview — restore any
  // authored inline transform we composed with during the drag.
  if (!element.hasAttribute('data-ark-editor-live-transform')) {
    return
  }

  element.style.transform = (cache && cache.liveTransformBase) || ''
  element.style.willChange = ''
  element.removeAttribute('data-ark-editor-live-transform')
}

export function applyLiveMovePreview(
  element: HTMLElement,
  slide: HTMLElement,
  geometry: NormalizedRect,
  startGeometry: NormalizedRect,
  positionContext?: PositionContext | null,
  cache?: TransformCache | null,
  silent?: boolean,
) {
  var rect = clampRect(geometry)
  var slideRect = cache!.slideRect!
  var dx = ((rect.x - startGeometry.x) * slideRect.width) / positionContext!.scaleX
  var dy = ((rect.y - startGeometry.y) * slideRect.height) / positionContext!.scaleY
  var composedBase =
    cache!.liveTransformBase && !isNonComposableTransform(cache!.liveTransformBase)
      ? cache!.liveTransformBase
      : ''
  var base = composedBase ? ' ' + composedBase : ''
  element.setAttribute('data-ark-editor-live-transform', '')
  element.style.willChange = 'transform'
  element.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)' + base
  if (!silent) {
    postToParent({
      type: C.TRANSFORM_PREVIEW,
      elementId: resolveElementId(element, slide, runtime.currentSlideIndex),
      slideIndex: runtime.currentSlideIndex,
      geometry: rect,
      zIndex: cache!.zIndex,
      slideBounds: cache!.slideBounds,
    })
    updateResizeHandles(element, slide, rect, cache)
  }
  return rect
}

function writeTransformSize(
  element: HTMLElement,
  slide: HTMLElement,
  rect: NormalizedRect,
  slideRect: { width: number; height: number },
  positionContext?: PositionContext | null,
) {
  var containingScale = positionContext
    ? { x: positionContext.scaleX, y: positionContext.scaleY }
    : readContainingBlockScale(element, slide)
  element.style.width = (rect.width * slideRect.width) / containingScale.x + 'px'

  if (isImageElement(element)) {
    element.style.height = (rect.height * slideRect.height) / containingScale.y + 'px'
    element.style.minHeight = ''
    return
  }

  element.style.minHeight = (rect.height * slideRect.height) / containingScale.y + 'px'
  element.style.height = ''
}

export function applyTransform(
  element: HTMLElement,
  slide: HTMLElement,
  geometry: NormalizedRect,
  preview: boolean,
  mode: string,
  adopted?: boolean,
  positionContext?: PositionContext | null,
  cache?: TransformCache | null,
  silent?: boolean,
) {
  var slideRect = (cache && cache.slideRect) || getSlideCoordinateRect(slide)
  var rect = clampRect(geometry)

  if (!slideRect.width || !slideRect.height) {
    return rect
  }

  if (preview && mode === 'move' && cache && cache.liveTransform && cache.startGeometry) {
    return applyLiveMovePreview(
      element,
      slide,
      rect,
      cache.startGeometry,
      positionContext,
      cache,
      silent,
    )
  }

  clearLiveTransform(element, cache)

  var spacerFootprint = cache && cache.spacerFootprint ? cache.spacerFootprint : null
  // Keep the member cache so adopted companions can still store commitPayload
  // after we null the local layout cache used for post-adopt remeasure.
  var commitCache = cache

  if (adopted && !preview) {
    adoptMove(element, slide, rect, cache?.logicalWidth, positionContext, cache)
    spacerFootprint = (cache && cache.spacerFootprint) || spacerFootprint
    // Flow removal shifts containing-block geometry; remeasure without the
    // pre-adopt margin cache (adopt zeroes margins). Keep spacerFootprint for
    // the commit payload after nulling the layout cache.
    cache = null
  }

  element.style.position = 'absolute'
  var cssPosition = preview
    ? setSlideRelativePosition(element, slide, rect, positionContext, cache)
    : settleSlideRelativePosition(element, slide, rect, positionContext, cache)

  // A pure move must not touch the element size. Only rewrite width/height
  // during a resize, otherwise elements sized with an explicit height would
  // silently change dimensions when merely repositioned.
  if (mode !== 'move') {
    writeTransformSize(element, slide, rect, slideRect, positionContext)
  }

  if (preview) {
    if (!silent) {
      postToParent({
        type: C.TRANSFORM_PREVIEW,
        elementId: resolveElementId(element, slide, runtime.currentSlideIndex),
        slideIndex: runtime.currentSlideIndex,
        geometry: rect,
        zIndex: cache && cache.zIndex != null ? cache.zIndex : readZIndex(element),
        slideBounds: (cache && cache.slideBounds) || normalizeSlideBounds(slide),
      })
      updateResizeHandles(element, slide, rect, cache)
    }
  } else {
    var logicalSlideWidth = (cache && cache.logicalSlideWidth) || getSlideLogicalWidth(slide)
    var logicalSlideHeight = (cache && cache.logicalSlideHeight) || getSlideLogicalHeight(slide)
    var commitPayload: Record<string, unknown> = {
      elementId: resolveElementId(element, slide, runtime.currentSlideIndex),
      slideIndex: runtime.currentSlideIndex,
      geometry: rect,
      zIndex: readZIndex(element),
      slideBounds: normalizeSlideBounds(slide),
      adopted: adopted ? true : undefined,
      cssX: cssPosition.x,
      cssY: cssPosition.y,
      cssWidth:
        adopted || mode !== 'move'
          ? readLogicalWidth(element, slide) / logicalSlideWidth
          : undefined,
      cssHeight:
        mode !== 'move' ? readLogicalHeight(element, slide) / logicalSlideHeight : undefined,
      slideWidth: logicalSlideWidth,
      slideHeight: logicalSlideHeight,
      spacer: adopted && spacerFootprint ? spacerFootprint : undefined,
    }

    if (commitCache) {
      commitCache.commitPayload = commitPayload
    }

    if (!silent) {
      var postedCommit: Record<string, unknown> = { type: C.TRANSFORM_COMMIT }
      for (var commitKey in commitPayload) {
        if (Object.prototype.hasOwnProperty.call(commitPayload, commitKey)) {
          postedCommit[commitKey] = commitPayload[commitKey]
        }
      }

      if (
        runtime.transformState &&
        runtime.transformState!.members &&
        runtime.transformState!.members.length > 1 &&
        element === runtime.transformState!.element
      ) {
        var companions = []

        for (var m = 0; m < runtime.transformState!.members.length; m++) {
          var memberPayload =
            runtime.transformState!.members[m].cache &&
            runtime.transformState!.members[m].cache.commitPayload

          if (memberPayload && runtime.transformState!.members[m].element !== element) {
            companions.push(memberPayload)
          }
        }

        if (companions.length) {
          postedCommit.companions = companions
        }
      }

      postToParent(postedCommit)
      refreshSelectionChrome(element, slide, runtime.currentSlideIndex)
    }
  }

  return rect
}

export function resizeRectWithHandle(
  startGeometry: NormalizedRect,
  handle: string,
  pointer: PendingPointer | null,
  slide: HTMLElement,
  element: HTMLElement,
) {
  var start = clampRect(startGeometry)
  var current = pointerToNormalized(pointer!.clientX, pointer!.clientY, slide)
  var rect = {
    x: start.x,
    y: start.y,
    width: start.width,
    height: start.height,
  }

  if (handle.indexOf('e') !== -1) {
    rect.width = Math.max(C.MIN_BOX_SIZE, current.x - start.x)
  }

  if (handle.indexOf('s') !== -1) {
    rect.height = Math.max(C.MIN_BOX_SIZE, current.y - start.y)
  }

  if (handle.indexOf('w') !== -1) {
    rect.width = Math.max(C.MIN_BOX_SIZE, start.x + start.width - current.x)
    rect.x = current.x
  }

  if (handle.indexOf('n') !== -1) {
    rect.height = Math.max(C.MIN_BOX_SIZE, start.y + start.height - current.y)
    rect.y = current.y
  }

  var cornerHandle = handle.length === 2

  if (element && (isImageElement(element) || (pointer!.shiftKey && cornerHandle))) {
    var aspectRatio = isImageElement(element)
      ? getImageAspectRatio(element)
      : ((start.width / Math.max(start.height, C.MIN_BOX_SIZE)) *
          getSlideCoordinateRect(slide).width) /
        getSlideCoordinateRect(slide).height
    var locked = applyImageAspectRatio(rect, aspectRatio, slide, start)

    if (handle.indexOf('w') !== -1) {
      locked.x = start.x + start.width - locked.width
    }

    if (handle.indexOf('n') !== -1) {
      locked.y = start.y + start.height - locked.height
    }

    return locked
  }

  return clampRect(rect)
}

export function findResizeHandle(target: EventTarget | null): string | null {
  var element = target as HTMLElement | null
  if (!element || !element.getAttribute) {
    return null
  }

  if (element.getAttribute('data-ark-editor-handle')) {
    return element.getAttribute('data-ark-editor-handle')
  }

  return null
}

export function snapshotInlineStyle(element: HTMLElement) {
  return {
    hadStyle: element.hasAttribute('style'),
    style: element.getAttribute('style') || '',
  }
}

export function restoreInlineStyle(element: HTMLElement, snapshot?: InlineSnapshot | null) {
  if (!snapshot) {
    return
  }

  if (snapshot.hadStyle) {
    element.setAttribute('style', snapshot.style)
  } else {
    element.removeAttribute('style')
  }
}

export function findContainingBlock(element: HTMLElement, slide: HTMLElement): HTMLElement {
  if (element.offsetParent) {
    return element.offsetParent as HTMLElement
  }

  var parent = element.parentElement

  while (parent) {
    var style = window.getComputedStyle(parent)

    if (
      (style.position && style.position !== 'static') ||
      (style.transform && style.transform !== 'none')
    ) {
      return parent
    }

    parent = parent.parentElement
  }

  return (document.documentElement as HTMLElement) || slide
}

export function readLogicalWidth(element: HTMLElement, slide: HTMLElement) {
  if (element.offsetWidth) {
    return element.offsetWidth
  }

  if (element.style.width && /px$/i.test(element.style.width)) {
    return Number.parseFloat(element.style.width) || 0
  }

  var scale = readContainingBlockScale(element, slide).x
  return element.getBoundingClientRect().width / scale
}

export function readLogicalHeight(element: HTMLElement, slide: HTMLElement) {
  if (element.offsetHeight) {
    return element.offsetHeight
  }

  if (element.style.height && /px$/i.test(element.style.height)) {
    return Number.parseFloat(element.style.height) || 0
  }

  if (element.style.minHeight && /px$/i.test(element.style.minHeight)) {
    return Number.parseFloat(element.style.minHeight) || 0
  }

  var scale = readContainingBlockScale(element, slide).y
  return element.getBoundingClientRect().height / scale
}

export function readPositionContext(element: HTMLElement, slide: HTMLElement) {
  var containingBlock = findContainingBlock(element, slide)
  var blockRect = containingBlock.getBoundingClientRect()
  var blockWidth = containingBlock.offsetWidth
  var blockHeight = containingBlock.offsetHeight
  var scaleRect = blockRect

  if (containingBlock === slide && (!blockRect.width || !blockRect.height)) {
    scaleRect = getSlideCoordinateRect(slide)
    blockWidth = getSlideLogicalWidth(slide)
    blockHeight = getSlideLogicalHeight(slide)
  }

  return {
    containingBlock: containingBlock,
    scaleX: (blockWidth ? scaleRect.width / blockWidth : 1) || 1,
    scaleY: (blockHeight ? scaleRect.height / blockHeight : 1) || 1,
  }
}

export function readContainingBlockScale(element: HTMLElement, slide: HTMLElement) {
  var context = readPositionContext(element, slide)
  return { x: context.scaleX, y: context.scaleY }
}

export function restoreTransformMembers(state: TransformState | NudgeState | null) {
  if (!state) {
    return
  }

  var members = state.members && state.members.length ? state.members : null

  if (members) {
    for (var i = 0; i < members.length; i++) {
      clearLiveTransform(members[i].element, members[i].cache)
      restoreInlineStyle(members[i].element, members[i].snapshot)
      cleanupAdoptSideEffects(members[i].element, members[i].cache)
    }

    return
  }

  if (state.element) {
    clearLiveTransform(state.element, state.cache)
    restoreInlineStyle(state.element, state.snapshot)
    cleanupAdoptSideEffects(state.element, state.cache)
  }
}

export function applyGroupMove(
  state: TransformState,
  slide: HTMLElement,
  snappedRect: NormalizedRect,
  preview: boolean,
) {
  var deltaX = snappedRect.x - state.startGeometry!.x
  var deltaY = snappedRect.y - state.startGeometry!.y
  var members = state.members && state.members.length ? state.members : null
  var primaryRect = applyTransform(
    state.element!,
    slide,
    snappedRect,
    preview,
    'move',
    state.adopted,
    state.positionContext,
    state.cache,
    false,
  )

  if (!members) {
    return primaryRect
  }

  for (var i = 0; i < members.length; i++) {
    if (members[i].element === state.element) {
      members[i].lastGeometry = primaryRect
      continue
    }

    members[i].lastGeometry = applyTransform(
      members[i].element,
      slide,
      {
        x: members[i].startGeometry.x + deltaX,
        y: members[i].startGeometry.y + deltaY,
        width: members[i].startGeometry.width,
        height: members[i].startGeometry.height,
      },
      preview,
      'move',
      members[i].adopted,
      members[i].positionContext,
      members[i].cache,
      true,
    )
  }

  return primaryRect
}

export function commitGroupMove(state: TransformState, slide: HTMLElement) {
  var members = state.members && state.members.length ? state.members : null
  var finalGeometry = state.lastGeometry || normalizeRect(state.element!, slide)

  if (members) {
    var deltaX = finalGeometry.x - state.startGeometry!.x
    var deltaY = finalGeometry.y - state.startGeometry!.y

    for (var i = 0; i < members.length; i++) {
      if (members[i].element === state.element) {
        continue
      }

      applyTransform(
        members[i].element,
        slide,
        members[i].lastGeometry || {
          x: members[i].startGeometry.x + deltaX,
          y: members[i].startGeometry.y + deltaY,
          width: members[i].startGeometry.width,
          height: members[i].startGeometry.height,
        },
        false,
        'move',
        members[i].adopted,
        members[i].positionContext,
        members[i].cache,
        true,
      )
    }
  }

  applyTransform(
    state.element!,
    slide,
    finalGeometry,
    false,
    state.kind || 'move',
    state.adopted,
    state.positionContext,
    state.cache,
    false,
  )
}
