import './constants.ts'

export function findSlides(): HTMLElement[] {
  for (var i = 0; i < C.SELECTORS.length; i++) {
    var found = document.querySelectorAll(C.SELECTORS[i]!)

    if (found.length) {
      return Array.prototype.slice.call(found)
    }
  }

  return []
}

export function detectRuntimeKind() {
  if (document.querySelector('.reveal .slides > section')) {
    return 'reveal'
  }

  if (document.querySelector('section.slide')) {
    return 'plain'
  }

  return 'unknown'
}

export function readMetadata() {
  return {
    runtime: detectRuntimeKind(),
    title: document.title || '',
    previewMode: C.PREVIEW_MODE,
    protocolVersion: C.PROTOCOL_VERSION,
  }
}

export function onDocumentReady(callback: () => void) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback)
  } else {
    callback()
  }
}
