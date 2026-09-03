import './constants.ts'
import { asHtml } from './types.ts'
import { isNestedInSelection } from './chrome.ts'
import {
  canEditInspectorGeometry,
  getTextEditTarget,
  isImageElement,
  isManagedElement,
  isTextBox,
} from './geometry.ts'
import { clampIndex, postToParent } from './port.ts'
import { runtime } from './state.ts'
import { detectSurface } from './surface.ts'

export function findSlides(): HTMLElement[] {
  var revealSlides = document.querySelector('.reveal .slides')

  if (revealSlides) {
    var flattened: HTMLElement[] = []
    var horizontal = Array.prototype.filter.call(revealSlides.children, function (element) {
      return element.tagName && element.tagName.toLowerCase() === 'section'
    })

    horizontal.forEach(function (section) {
      var vertical = Array.prototype.filter.call(section.children, function (element) {
        return element.tagName && element.tagName.toLowerCase() === 'section'
      })
      Array.prototype.push.apply(flattened, vertical.length ? vertical : [section])
    })

    if (flattened.length) {
      return flattened
    }
  }

  for (var i = 0; i < C.SELECTORS.length; i++) {
    var found = document.querySelectorAll(C.SELECTORS[i])

    if (found.length) {
      return Array.prototype.slice.call(found)
    }
  }

  return []
}

export function getActiveSlide(): HTMLElement | null {
  var slides = findSlides()

  return slides[clampIndex(runtime.currentSlideIndex, slides.length)] || null
}

export function getElementPath(element: HTMLElement, slide: HTMLElement) {
  var path = []
  var current = element

  while (current && current !== slide) {
    var parent = current.parentElement

    if (!parent) {
      break
    }

    var index = Array.prototype.indexOf.call(parent.children, current)
    path.unshift(index)
    current = parent
  }

  return path.join('.')
}

export function resolveElementId(element: HTMLElement, slide: HTMLElement, slideIndex: number) {
  var nativeId = element.getAttribute(C.ELEMENT_ID_ATTR)

  if (nativeId && nativeId.trim()) {
    return nativeId.trim()
  }

  return C.TRANSIENT_PREFIX + slideIndex + '-' + getElementPath(element, slide)
}

export function isUnsafeTag(tag: string) {
  return (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'iframe' ||
    tag === 'form' ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select'
  )
}

export function isEditableCandidate(element: HTMLElement | null, slide: HTMLElement): boolean {
  if (!element || element === slide || !slide.contains(element)) {
    return false
  }

  var tag = element.tagName.toLowerCase()

  if (isUnsafeTag(tag)) {
    return false
  }

  if (tag === 'aside' && element.classList.contains('notes')) {
    return false
  }

  if (
    element.closest(
      '[data-ark-editor-handle], [data-ark-editor-marquee], [data-ark-editor-guide], [' +
        C.SPACER_ATTR +
        ']',
    )
  ) {
    return false
  }

  var bounds = element.getBoundingClientRect()

  if (!bounds.width || !bounds.height) {
    return false
  }

  if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
    return true
  }

  if (element.hasAttribute(C.ELEMENT_ID_ATTR)) {
    return true
  }

  if (
    element.getAttribute(C.EDITABLE_ATTR) === C.TEXT_BOX_EDITABLE ||
    element.classList.contains(C.TEXT_BOX_CLASS)
  ) {
    return true
  }

  return (
    tag === 'h1' ||
    tag === 'h2' ||
    tag === 'h3' ||
    tag === 'h4' ||
    tag === 'h5' ||
    tag === 'h6' ||
    tag === 'p' ||
    tag === 'li' ||
    tag === 'button' ||
    tag === 'figcaption' ||
    tag === 'span' ||
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'div' ||
    tag === 'section' ||
    tag === 'ul' ||
    tag === 'ol' ||
    tag === 'table' ||
    tag === 'blockquote' ||
    tag === 'pre' ||
    tag === 'figure' ||
    tag === 'a' ||
    tag === 'hr'
  )
}

export function findManagedAncestor(element: HTMLElement, slide: HTMLElement) {
  var current: HTMLElement | null = element

  while (current && current !== slide) {
    if (
      current.nodeType === 1 &&
      isManagedElement(current) &&
      isEditableCandidate(current, slide)
    ) {
      return current
    }

    current = current.parentElement
  }

  return null
}

export function findEditableTarget(
  node: EventTarget | Node | null,
  slide: HTMLElement,
): HTMLElement | null {
  var current: HTMLElement | null = node ? asHtml(node) : null

  while (current && current !== slide) {
    if (current.nodeType === 1 && isEditableCandidate(current, slide)) {
      var managedAncestor = findManagedAncestor(current, slide)

      // First click selects a managed group; later clicks stay drilled into it
      // (or deepen) while selection remains inside the group. Text boxes stay
      // one object because their child stores the editable text.
      var drilled =
        managedAncestor === runtime.selectedElement ||
        (runtime.selectedElement &&
          managedAncestor &&
          managedAncestor.contains(runtime.selectedElement))

      return managedAncestor && (isTextBox(managedAncestor) || !drilled) ? managedAncestor : current
    }

    current = current.parentElement
  }

  return null
}

export function readTextPreview(element: HTMLElement) {
  var text = (element.textContent || '').replace(/\s+/g, ' ').trim()

  if (!text && element.getAttribute('alt')) {
    text = element.getAttribute('alt') || ''
  }

  return text || null
}

export function isTextEditableTag(tag: string) {
  return C.INLINE_TEXT_TAGS.indexOf(tag) !== -1
}

export function postTextEditState(active: boolean, elementId?: string, slideIndex?: number) {
  if (active) {
    postToParent({
      type: C.TEXT_EDIT_STATE,
      active: true,
      elementId: elementId,
      slideIndex: slideIndex,
    })
    return
  }

  postToParent({ type: C.TEXT_EDIT_STATE, active: false })
}

export function readImageFit(element: HTMLElement) {
  if (!isImageElement(element)) {
    return null
  }

  var stored = element.getAttribute('data-ark-fit')

  if (stored === 'contain' || stored === 'cover' || stored === 'fill') {
    return stored
  }

  var computed = window.getComputedStyle(element).objectFit

  if (computed === 'cover' || computed === 'fill') {
    return computed
  }

  return 'contain'
}

export function readTextStyle(element: HTMLElement) {
  if (isImageElement(element)) {
    return null
  }

  var target = getTextEditTarget(element) || element
  var computed = window.getComputedStyle(target)
  var fontSize = Number.parseFloat(computed.fontSize)
  var lineHeight = Number.parseFloat(computed.lineHeight)

  if (!Number.isFinite(fontSize)) {
    return null
  }

  return {
    fontSize: fontSize,
    fontWeight: String(computed.fontWeight || '400'),
    color: String(computed.color || ''),
    textAlign: String(computed.textAlign || ''),
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : null,
  }
}

export function readImageNaturalSize(element: HTMLElement) {
  var image = element as HTMLImageElement
  if (
    element.tagName.toLowerCase() === 'img' &&
    image.naturalWidth > 0 &&
    image.naturalHeight > 0
  ) {
    return { width: image.naturalWidth, height: image.naturalHeight }
  }

  return null
}

export function buildSelection(element: HTMLElement, slide: HTMLElement, slideIndex: number) {
  var info: {
    elementId: string
    slideIndex: number
    slideId: string | null
    tagName: string
    locked: boolean
    managed: boolean
    editableKind: string | null
    textPreview: string | null
    imageFit: string | null
    surface: 'light' | 'dark'
    geometryEditable: boolean
    role: string | null
    textStyle: ReturnType<typeof readTextStyle>
    imageNaturalSize: ReturnType<typeof readImageNaturalSize>
    nestedInSelection?: boolean
  } = {
    elementId: resolveElementId(element, slide, slideIndex),
    slideIndex: slideIndex,
    slideId: slide.getAttribute('data-ark-slide-id') || null,
    tagName: element.tagName.toLowerCase(),
    locked: element.getAttribute(C.LOCKED_ATTR) === 'true',
    managed: isManagedElement(element),
    editableKind: element.getAttribute(C.EDITABLE_ATTR) || null,
    textPreview: readTextPreview(element),
    imageFit: readImageFit(element),
    surface: detectSurface(element, slide),
    geometryEditable: canEditInspectorGeometry(element, slide),
    role: element.getAttribute(C.ROLE_ATTR) || null,
    textStyle: readTextStyle(element),
    imageNaturalSize: readImageNaturalSize(element),
  }

  if (isNestedInSelection(element)) {
    info.nestedInSelection = true
  }

  return info
}
