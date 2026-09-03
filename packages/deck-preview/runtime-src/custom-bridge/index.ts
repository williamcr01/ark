import '../shared/constants.ts'
import { isParentWindowMessage, readGotoIndex } from '../shared/message.ts'
import { installErrorListeners, postToParent } from '../shared/post.ts'
import { findSlides, onDocumentReady, readMetadata } from '../shared/slides.ts'
import { clampIndex, isRecord } from '../shared/values.ts'

function findSlideCount() {
  return findSlides().length
}

function postSlideChange(index: number, slideCount: number) {
  var clamped = clampIndex(index, slideCount)
  postToParent({ type: C.CHANGE, index: clamped })
}

function postReady(index: number, slideCount: number) {
  var metadata = readMetadata()
  postToParent({
    type: C.READY,
    index: clampIndex(index, slideCount),
    slideCount: slideCount,
    metadata: metadata,
  })
  postToParent({ type: C.SLIDE_COUNT, slideCount: slideCount })
  postToParent({ type: C.METADATA, metadata: metadata })
}

window.addEventListener('message', function (event) {
  if (!isParentWindowMessage(event)) {
    return
  }

  var gotoIndex = readGotoIndex(event.data)

  if (gotoIndex !== null) {
    document.dispatchEvent(
      new CustomEvent(C.GOTO, {
        detail: { index: gotoIndex },
      }),
    )
  }
})

document.addEventListener(C.CHANGE, function (event) {
  var detail = ((event as CustomEvent).detail || {}) as { index?: number }
  var slideCount = findSlideCount()
  postSlideChange(detail.index as number, slideCount)
})

document.addEventListener(C.METADATA, function (event) {
  var detail = ((event as CustomEvent).detail || {}) as { metadata?: unknown }
  var metadata = detail.metadata

  if (!isRecord(metadata)) {
    return
  }

  postToParent({
    type: C.METADATA,
    metadata: {
      runtime: metadata.runtime || 'unknown',
      title: typeof metadata.title === 'string' ? metadata.title : document.title || '',
      previewMode: metadata.previewMode === 'full-js' ? 'full-js' : C.PREVIEW_MODE,
      protocolVersion: C.PROTOCOL_VERSION,
    },
  })
})

installErrorListeners()

function announceReady(index: number) {
  var slideCount = findSlideCount()
  postReady(index, slideCount)
}

onDocumentReady(function () {
  announceReady(0)
})
