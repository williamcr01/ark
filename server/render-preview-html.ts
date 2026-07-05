import { JSDOM } from 'jsdom'

import { buildPreviewHtml } from '../shared/deck-preview-html.ts'

type DomGlobals = {
  document?: Document
  DOMParser?: typeof DOMParser
  NodeFilter?: typeof NodeFilter
}

function captureDomGlobals(): DomGlobals {
  return {
    document: globalThis.document,
    DOMParser: globalThis.DOMParser,
    NodeFilter: globalThis.NodeFilter,
  }
}

function restoreDomGlobals(previous: DomGlobals) {
  if (previous.document) {
    globalThis.document = previous.document
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }

  if (previous.DOMParser) {
    globalThis.DOMParser = previous.DOMParser
  } else {
    Reflect.deleteProperty(globalThis, 'DOMParser')
  }

  if (previous.NodeFilter) {
    globalThis.NodeFilter = previous.NodeFilter
  } else {
    Reflect.deleteProperty(globalThis, 'NodeFilter')
  }
}

export function withDomEnvironment<T>(callback: () => T): T {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://sandbox.ark.local/',
  })
  const previous = captureDomGlobals()

  globalThis.document = dom.window.document as Document
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser
  globalThis.NodeFilter = dom.window.NodeFilter as typeof NodeFilter

  try {
    return callback()
  } finally {
    restoreDomGlobals(previous)
    dom.window.close()
  }
}

export function renderPreviewHtml(html: string, options: { parentOrigin?: string } = {}) {
  return withDomEnvironment(() => buildPreviewHtml(html, options))
}
