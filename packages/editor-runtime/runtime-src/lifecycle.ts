import './constants.ts'
import {
  clearEditorOverlays,
  clearHoverCursor,
  clearSelectionStyles,
  ensureEditorStyle,
  findElementById,
  isSelectionMember,
  postGeometryForElement,
  postSelection,
  refreshSelectionChrome,
  setSelectedElement,
  updateResizeHandles,
} from './chrome.ts'
import { cancelTransform, finishNudge, onKeyDown } from './keyboard.ts'
import {
  finishTransform,
  onDoubleClick,
  onLostPointerCapture,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
} from './pointer.ts'
import { isRecord, postError, postToParent } from './port.ts'
import { getActiveSlide } from './selection.ts'
import { runtime } from './state.ts'
import { endTextEdit, startTextEditOnElement } from './text-edit.ts'
import { restoreTransformMembers } from './transform.ts'
import type { EditorTool } from './types.ts'

export function bindListeners() {
  if (runtime.listenersBound) {
    return
  }

  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('lostpointercapture', onLostPointerCapture, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  runtime.listenersBound = true
}

export function unbindListeners() {
  if (!runtime.listenersBound) {
    return
  }

  document.removeEventListener('pointermove', onPointerMove, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('pointerup', onPointerUp, true)
  document.removeEventListener('pointercancel', onPointerCancel, true)
  document.removeEventListener('lostpointercapture', onLostPointerCapture, true)
  document.removeEventListener('dblclick', onDoubleClick, true)
  document.removeEventListener('keydown', onKeyDown, true)
  runtime.listenersBound = false
}

export function enableEditor(slideIndex: number, tool?: string, scale?: number) {
  finishNudge()
  var previousSlide = getActiveSlide()!

  if (runtime.transformState) {
    if (previousSlide) {
      cancelTransform(previousSlide)
    } else {
      restoreTransformMembers(runtime.transformState)
      runtime.transformState = null
      clearEditorOverlays()
    }
  }

  runtime.enabled = true
  if (runtime.currentSlideIndex !== slideIndex) {
    clearSelectionStyles()
  }
  runtime.currentSlideIndex = slideIndex
  runtime.currentTool = (tool || 'select') as EditorTool
  runtime.editorScale =
    typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : runtime.editorScale
  ensureEditorStyle()
  bindListeners()
  postToParent({
    type: C.READY,
    slideIndex: runtime.currentSlideIndex,
    protocolVersion: C.PROTOCOL_VERSION,
  })
}

export function disableEditor() {
  runtime.enabled = false

  if (runtime.transformState && runtime.transformState!.element) {
    restoreTransformMembers(runtime.transformState)
  }

  runtime.transformState = null
  window.clearTimeout(
    runtime.nudgeState && runtime.nudgeState!.timer ? runtime.nudgeState.timer : undefined,
  )

  if (runtime.nudgeState && runtime.nudgeState!.element) {
    restoreTransformMembers(runtime.nudgeState)
  }

  runtime.nudgeState = null
  endTextEdit(false)
  clearSelectionStyles()
  clearEditorOverlays()
  clearHoverCursor()
  runtime.selectedElement = null
  postToParent({ type: C.SELECTION_CHANGE, selection: null })
  postToParent({ type: C.HOVER, slideIndex: runtime.currentSlideIndex, elementId: null })
}

export function handleShellMessage(data: unknown) {
  if (!isRecord(data) || typeof data.type !== 'string' || data.type.indexOf('ark:editor-') !== 0) {
    return
  }

  try {
    if (data.type === C.ENABLE && typeof data.slideIndex === 'number') {
      enableEditor(
        data.slideIndex,
        typeof data.tool === 'string' ? data.tool : undefined,
        typeof data.scale === 'number' ? data.scale : undefined,
      )
      return
    }

    if (
      data.type === C.CONFIGURE &&
      typeof data.scale === 'number' &&
      Number.isFinite(data.scale) &&
      data.scale > 0
    ) {
      runtime.editorScale = data.scale

      if (runtime.enabled && runtime.selectedElement) {
        var configuredSlide = getActiveSlide()!

        if (configuredSlide) {
          updateResizeHandles(runtime.selectedElement, configuredSlide)
        }
      }

      return
    }

    if (data.type === C.DISABLE) {
      disableEditor()
      return
    }

    if (!runtime.enabled) {
      return
    }

    if (data.type === C.TRANSFORM_CANCEL) {
      cancelTransform(getActiveSlide()!)
      return
    }

    if (data.type === C.TRANSFORM_END) {
      finishTransform(getActiveSlide()!, null)
      return
    }

    if (
      data.type === C.ASSIGN_ID &&
      typeof data.fromElementId === 'string' &&
      typeof data.toElementId === 'string' &&
      typeof data.slideIndex === 'number'
    ) {
      runtime.currentSlideIndex = data.slideIndex
      var assignSlide = getActiveSlide()!

      if (!assignSlide) {
        postError('No active slide found for editor command.', 'missing-slide')
        return
      }

      var assignTarget = findElementById(data.fromElementId, assignSlide, data.slideIndex)

      if (!assignTarget) {
        postError('Element "' + data.fromElementId + '" was not found.', 'missing-element')
        return
      }

      assignTarget.setAttribute(C.ELEMENT_ID_ATTR, data.toElementId)

      if (data.managed) {
        assignTarget.setAttribute(C.MANAGED_ATTR, 'true')
      }

      if (runtime.selectedElement === assignTarget || isSelectionMember(assignTarget)) {
        postSelection(assignTarget, assignSlide, data.slideIndex)
        refreshSelectionChrome(
          runtime.selectedElement || assignTarget,
          assignSlide,
          data.slideIndex,
        )
      }

      return
    }

    if (data.type === C.CLEAR_SELECTION) {
      var clearSlide = getActiveSlide()!

      if (!clearSlide) {
        postError('No active slide found for editor command.', 'missing-slide')
        return
      }

      setSelectedElement(null, clearSlide, runtime.currentSlideIndex)
      postSelection(null, clearSlide, runtime.currentSlideIndex)
      return
    }

    if (
      data.type === C.SET_TOOL &&
      (data.tool === 'select' || data.tool === 'text' || data.tool === 'insert')
    ) {
      runtime.currentTool = data.tool
      var toolSlide = getActiveSlide()!

      if (toolSlide) {
        cancelTransform(toolSlide)
      }

      clearEditorOverlays()
      return
    }

    if (
      (data.type === C.SELECT ||
        data.type === C.REQUEST_GEOMETRY ||
        data.type === C.START_TEXT_EDIT) &&
      typeof data.elementId === 'string' &&
      typeof data.slideIndex === 'number'
    ) {
      // Update the active slide index before resolving the slide so geometry
      // and selection target the requested slide during rapid navigation.
      runtime.currentSlideIndex = data.slideIndex
      var slide = getActiveSlide()!

      if (!slide) {
        postError('No active slide found for editor command.', 'missing-slide')
        return
      }

      var element = findElementById(data.elementId, slide, data.slideIndex)

      if (!element) {
        postError('Element "' + data.elementId + '" was not found.', 'missing-element')
        return
      }

      if (data.type === C.SELECT) {
        setSelectedElement(element, slide, data.slideIndex)
        postSelection(element, slide, data.slideIndex)
        return
      }

      if (data.type === C.REQUEST_GEOMETRY) {
        postGeometryForElement(element, slide, data.slideIndex)
        return
      }

      if (data.type === C.START_TEXT_EDIT) {
        startTextEditOnElement(element, slide, data.slideIndex)
        return
      }
    }

    if (data.type === C.CANCEL_TEXT_EDIT) {
      endTextEdit(false)
      return
    }
  } catch (error: unknown) {
    var caught = error as { message?: string }
    postError(caught && caught.message ? caught.message : String(error), 'editor-runtime')
  }
}

export function bootstrap() {
  // Register before deck-authored listeners. The handlers stay dormant while
  // editing is disabled, preserving normal deck interaction.
  bindListeners()

  document.addEventListener(
    'focusout',
    function (event: FocusEvent) {
      if (!runtime.textEditElement || event.target !== runtime.textEditElement) {
        return
      }

      endTextEdit(true)
    },
    true,
  )
}
