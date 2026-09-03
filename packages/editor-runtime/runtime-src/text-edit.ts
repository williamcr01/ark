import './constants.ts'
import { clearEditorOverlays, clearHoverCursor } from './chrome.ts'
import { getTextEditTarget, isTextBox } from './geometry.ts'
import { postError, postToParent } from './port.ts'
import {
  getActiveSlide,
  isTextEditableTag,
  postTextEditState,
  resolveElementId,
} from './selection.ts'
import { runtime } from './state.ts'

export function endTextEdit(commit?: boolean) {
  if (!runtime.textEditElement) {
    return
  }

  var slide = getActiveSlide()!
  var element = runtime.textEditElement
  var slideIndex = runtime.currentSlideIndex
  var savedOriginalText = runtime.originalTextBeforeEdit

  if (!commit && runtime.originalTextBeforeEdit !== null) {
    element.textContent = runtime.originalTextBeforeEdit
  }

  runtime.textEditElement.removeAttribute('contenteditable')
  runtime.textEditElement.removeAttribute('data-ark-editor-text-edit')

  if (commit && slide) {
    postToParent({
      type: C.TEXT_COMMIT,
      elementId: resolveElementId(element, slide, slideIndex),
      slideIndex: slideIndex,
      slideId: slide.getAttribute('data-ark-slide-id') || null,
      text: element.textContent || '',
      originalText: savedOriginalText || '',
    })
  }

  postTextEditState(false)
  runtime.originalTextBeforeEdit = null
  runtime.textEditElement = null
}

export function startTextEditOnElement(
  element: HTMLElement,
  slide: HTMLElement,
  slideIndex: number,
) {
  var target = getTextEditTarget(element)

  if (!target) {
    postError('Element is not text-editable.', 'non-text-element')
    return
  }

  if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
    postError('Element is locked.', 'locked-element')
    return
  }

  var tag = target.tagName.toLowerCase()

  if (!isTextEditableTag(tag) && !isTextBox(element)) {
    postError('Element is not text-editable.', 'non-text-element')
    return
  }

  endTextEdit(false)
  clearHoverCursor()
  clearEditorOverlays()
  runtime.textEditElement = target
  runtime.originalTextBeforeEdit = target.textContent || ''
  target.setAttribute('contenteditable', 'true')
  target.setAttribute('data-ark-editor-text-edit', '')
  target.focus()

  try {
    var selection = window.getSelection()

    if (selection) {
      var range = document.createRange()
      range.selectNodeContents(target)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  } catch {
    // Ignore selection failures in older browsers.
  }

  postTextEditState(true, resolveElementId(element, slide, slideIndex), slideIndex)
}
