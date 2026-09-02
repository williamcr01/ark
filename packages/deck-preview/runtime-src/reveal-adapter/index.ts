import '../shared/constants.ts'
import { isParentWindowMessage, readGotoIndex, readSlidePatchCommand } from '../shared/message.ts'
import { installErrorListeners, postRuntimeError, postToParent } from '../shared/post.ts'
import { applySlidePatch } from '../shared/slide-patch.ts'
import { onDocumentReady } from '../shared/slides.ts'
import { clampIndex } from '../shared/values.ts'

type RevealIndices = { h: number; v: number; f: number }

type RevealThenable = {
  then: (onFulfilled: () => void) => {
    catch: (onRejected: (error: unknown) => void) => unknown
  }
}

type RevealApi = {
  initialize: (config: Record<string, unknown>) => RevealThenable | void
  getTotalSlides?: () => number
  getCurrentSlide?: () => Element | null
  getSlidePastCount?: (slide: Element) => number
  getSlides?: () => Element[]
  getIndices?: (slide?: Element) => RevealIndices
  slide: (h: number, v: number, f: number) => void
  sync: () => void
  on: (event: string, handler: () => void) => void
}

var revealReady = false
var lastReportedIndex = -1

function getReveal(): RevealApi | undefined {
  return (window as unknown as { Reveal?: RevealApi }).Reveal
}

function readMetadata() {
  return {
    runtime: 'reveal',
    title: document.title || '',
    previewMode: C.PREVIEW_MODE,
    protocolVersion: C.PROTOCOL_VERSION,
  }
}

function getSlideCount() {
  var Reveal = getReveal()
  return Reveal && typeof Reveal.getTotalSlides === 'function' ? Reveal.getTotalSlides() : 0
}

function getLinearIndex() {
  var Reveal = getReveal()

  if (!Reveal || typeof Reveal.getCurrentSlide !== 'function') {
    return 0
  }

  var slide = Reveal.getCurrentSlide()

  if (!slide || typeof Reveal.getSlidePastCount !== 'function') {
    return 0
  }

  return Reveal.getSlidePastCount(slide)
}

function postSlideChange(index: number, slideCount: number) {
  var clamped = clampIndex(index, slideCount)
  lastReportedIndex = clamped
  postToParent({ type: C.CHANGE, index: clamped })
  // Deck-authored Chart.js (and similar) init listens for this DOM event to
  // resize canvases after Reveal shows a previously hidden slide.
  document.dispatchEvent(
    new CustomEvent(C.CHANGE, {
      detail: { index: clamped },
    }),
  )
}

function postReady(index: number, slideCount: number) {
  var metadata = readMetadata()
  var clamped = clampIndex(index, slideCount)
  lastReportedIndex = clamped
  postToParent({
    type: C.READY,
    index: clamped,
    slideCount: slideCount,
    metadata: metadata,
  })
  postToParent({ type: C.SLIDE_COUNT, slideCount: slideCount })
  postToParent({ type: C.METADATA, metadata: metadata })
}

function gotoLinearIndex(index: number) {
  var Reveal = getReveal()

  if (!revealReady || !Reveal) {
    return
  }

  var slides = typeof Reveal.getSlides === 'function' ? Reveal.getSlides() : []

  if (!slides.length) {
    return
  }

  var clamped = clampIndex(index, slides.length)
  var targetSlide = slides[clamped]
  var indices =
    typeof Reveal.getIndices === 'function' && targetSlide
      ? Reveal.getIndices(targetSlide)
      : { h: clamped, v: 0, f: 0 }

  Reveal.slide(indices.h, indices.v, 0)
}

function handleSlideChanged() {
  var Reveal = getReveal()

  if (!revealReady || !Reveal) {
    return
  }

  var indices = typeof Reveal.getIndices === 'function' ? Reveal.getIndices() : { f: 0 }

  if (indices.f > 0) {
    return
  }

  var nextIndex = getLinearIndex()
  var slideCount = getSlideCount()

  if (nextIndex === lastReportedIndex) {
    return
  }

  postSlideChange(nextIndex, slideCount)
}

function bindReveal() {
  var Reveal = getReveal()

  if (!Reveal || revealReady) {
    return
  }

  var initResult = Reveal.initialize({
    hash: false,
    history: false,
    keyboard: false,
    controls: false,
    progress: false,
    center: true,
    embedded: true,
    autoSlide: 0,
    autoPlayMedia: false,
    previewLinks: false,
  })

  function finishReady() {
    var readyReveal = getReveal()

    if (!readyReveal) {
      return
    }

    revealReady = true
    readyReveal.on('slidechanged', handleSlideChanged)
    var index = getLinearIndex()
    var slideCount = getSlideCount()
    postReady(index, slideCount)
  }

  if (initResult && typeof initResult.then === 'function') {
    initResult.then(finishReady).catch(function (error) {
      var err = error as { message?: unknown }
      postRuntimeError(err && err.message ? err.message : String(error), 'reveal.initialize')
    })
    return
  }

  finishReady()
}

function waitForReveal(attempt: number) {
  if (getReveal()) {
    bindReveal()
    return
  }

  if (attempt >= 200) {
    postRuntimeError('Reveal.js failed to load', 'ark:reveal-adapter')
    return
  }

  window.setTimeout(function () {
    waitForReveal(attempt + 1)
  }, 25)
}

function handleParentMessage(event: MessageEvent) {
  if (!isParentWindowMessage(event)) {
    return
  }

  var data = event.data
  var gotoIndex = readGotoIndex(data)

  if (gotoIndex !== null) {
    gotoLinearIndex(gotoIndex)
    return
  }

  var patch = readSlidePatchCommand(data)

  if (!patch) {
    return
  }

  // Reveal owns slide layout, so patching before it is initialized would
  // leave the deck unsynced. Report failure and let the shell reload.
  var patched = revealReady ? applySlidePatch(patch.operations) : null
  var Reveal = getReveal()

  if (patched !== null && Reveal) {
    Reveal.sync()
    lastReportedIndex = -1
    gotoLinearIndex(typeof patch.index === 'number' ? patch.index : getLinearIndex())
    postToParent({ type: C.SLIDE_COUNT, slideCount: getSlideCount() })
    postSlideChange(getLinearIndex(), getSlideCount())
  }

  postToParent({
    type: C.PATCH_RESULT,
    patchId: String(patch.patchId),
    applied: patched !== null,
    slideCount: patched === null ? 0 : getSlideCount(),
  })
}

window.addEventListener('message', handleParentMessage)

installErrorListeners()

onDocumentReady(function () {
  waitForReveal(0)
})
