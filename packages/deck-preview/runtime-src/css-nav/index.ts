import '../shared/constants.ts'
import { isParentWindowMessage, readGotoIndex, readSlidePatchCommand } from '../shared/message.ts'
import { installErrorListeners, postToParent } from '../shared/post.ts'
import { applySlidePatch } from '../shared/slide-patch.ts'
import { findSlides, onDocumentReady, readMetadata } from '../shared/slides.ts'
import { clampIndex } from '../shared/values.ts'

var slides: HTMLElement[] = []
var currentIndex = 0
var hudPadWidth = 0

function padNum(n: number, width: number) {
  var s = String(n)

  while (s.length < width) {
    s = '0' + s
  }

  return s
}

function postReady(index: number, slideCount: number) {
  var metadata = readMetadata()
  var clamped = clampIndex(index, slideCount)
  postToParent({
    type: C.READY,
    index: clamped,
    slideCount: slideCount,
    metadata: metadata,
  })
  postToParent({ type: C.SLIDE_COUNT, slideCount: slideCount })
  postToParent({ type: C.METADATA, metadata: metadata })
}

function postSlideChange(index: number, slideCount: number) {
  postToParent({ type: C.CHANGE, index: clampIndex(index, slideCount) })
}

function syncCommonHud(index: number, count: number) {
  var currentEl = document.getElementById('currentSlide')
  var totalEl = document.getElementById('totalSlides')
  var progressEl = document.getElementById('progressBar')
  var prevEl = document.getElementById('prevSlide') as HTMLButtonElement | null
  var nextEl = document.getElementById('nextSlide') as HTMLButtonElement | null

  if (currentEl) {
    if (!hudPadWidth) {
      var initial = (currentEl.textContent || '').trim()
      hudPadWidth = initial.length > 0 ? initial.length : 2
    }

    currentEl.textContent = padNum(index + 1, hudPadWidth)
  }

  if (totalEl) {
    var padWidth = hudPadWidth

    if (!padWidth) {
      var totalInitial = (totalEl.textContent || '').trim()
      padWidth = totalInitial.length > 0 ? totalInitial.length : 2
    }

    totalEl.textContent = padNum(count, padWidth)
  }

  if (progressEl && count > 0) {
    progressEl.style.width = ((index + 1) / count) * 100 + '%'
  }

  if (prevEl) {
    prevEl.disabled = index === 0
  }

  if (nextEl) {
    nextEl.disabled = index === count - 1
  }
}

function showSlide(index: number) {
  slides = findSlides()

  if (!slides.length) {
    return
  }

  var nextIndex = clampIndex(index, slides.length)
  currentIndex = nextIndex

  for (var i = 0; i < slides.length; i++) {
    var slide = slides[i]!
    var isActive = i === nextIndex

    if (isActive) {
      slide.removeAttribute('data-ark-hidden')
      slide.setAttribute('data-ark-active', '')
      slide.classList.add('active', 'is-active', 'present')
      slide.setAttribute('aria-hidden', 'false')
      slide.setAttribute('data-active', '')
      slide.style.removeProperty('display')

      if (window.getComputedStyle(slide).display === 'none') {
        slide.style.setProperty('display', 'flex', 'important')
      }
    } else {
      slide.removeAttribute('data-ark-active')
      slide.setAttribute('data-ark-hidden', '')
      slide.classList.remove('active', 'is-active', 'present')
      slide.setAttribute('aria-hidden', 'true')
      slide.removeAttribute('data-active')
      slide.style.removeProperty('display')
    }
  }

  syncCommonHud(nextIndex, slides.length)
  postSlideChange(nextIndex, slides.length)
}

function isTypingTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object') {
    return false
  }

  var element = target as HTMLElement

  if (element.isContentEditable) {
    return true
  }

  if (element.closest) {
    return Boolean(element.closest('[contenteditable="true"], [data-ark-editor-text-edit]'))
  }

  return false
}

function handleNavKey(event: KeyboardEvent) {
  if (
    isTypingTarget(event.target) ||
    document.querySelector('[data-ark-editor-text-edit], [data-ark-editor-selected]')
  ) {
    return
  }

  var delta = C.NAV_KEYS[event.key]

  if (!delta) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  showSlide(currentIndex + delta)
}

function handleParentMessage(event: MessageEvent) {
  if (!isParentWindowMessage(event)) {
    return
  }

  var data = event.data
  var gotoIndex = readGotoIndex(data)

  if (gotoIndex !== null) {
    showSlide(gotoIndex)
    return
  }

  var patch = readSlidePatchCommand(data)

  if (!patch) {
    return
  }

  var patched = applySlidePatch(patch.operations)

  if (patched !== null) {
    slides = findSlides()
    showSlide(typeof patch.index === 'number' ? patch.index : currentIndex)
    postToParent({ type: C.SLIDE_COUNT, slideCount: slides.length })
  }

  postToParent({
    type: C.PATCH_RESULT,
    patchId: String(patch.patchId),
    applied: patched !== null,
    slideCount: patched === null ? 0 : patched,
  })
}

window.addEventListener('message', handleParentMessage)

document.addEventListener('keydown', handleNavKey, true)
window.addEventListener('keydown', handleNavKey, true)

installErrorListeners()

function init() {
  slides = findSlides()
  showSlide(0)
  postReady(currentIndex, slides.length)
}

onDocumentReady(init)
