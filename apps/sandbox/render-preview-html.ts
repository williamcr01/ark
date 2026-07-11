import { JSDOM } from 'jsdom'

import {
  buildPreviewDocument,
  buildPreviewHtml,
  injectPreviewHandshake,
  type PreviewDocumentResult,
  type PreviewHtmlOptions,
} from '@ark/deck-core/deck-preview-html.ts'
import { generateCspNonce } from '@ark/runtime-registry/csp-nonce.ts'
import { detectRuntimeMode } from '@ark/runtime-registry/deck-runtime.ts'
import {
  createPreviewHtmlCacheKey,
  defaultPreviewHtmlCache,
  PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER,
  type PreviewHtmlCache,
} from './preview-html-cache.ts'

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

export function renderPreviewDocument(
  html: string,
  options: PreviewHtmlOptions = {},
): PreviewDocumentResult {
  return withDomEnvironment(() => buildPreviewDocument(html, options))
}

export type CachedPreviewDocumentResult = PreviewDocumentResult & {
  cacheKey: string | null
  cacheStatus: 'hit' | 'miss' | 'bypass'
}

function createFreshPreviewNonce(runtimeMode: PreviewDocumentResult['runtimeMode']) {
  return runtimeMode === 'custom-js' ? null : generateCspNonce()
}

export function renderCachedPreviewDocument(
  html: string,
  options: PreviewHtmlOptions = {},
  cache: PreviewHtmlCache = defaultPreviewHtmlCache,
): CachedPreviewDocumentResult {
  return withDomEnvironment(() => {
    if (!html) {
      return {
        ...buildPreviewDocument(html, options),
        cacheKey: null,
        cacheStatus: 'bypass',
      }
    }

    const runtimeMode = options.manifest?.runtimeMode ?? detectRuntimeMode(html)
    const cacheKey = createPreviewHtmlCacheKey({
      html,
      parentOrigin: options.parentOrigin ?? '',
      runtimeMode,
      editorBridge: options.editorBridge === true,
    })
    const cached = cache.get(cacheKey)

    if (cached) {
      const nonce = createFreshPreviewNonce(cached.runtimeMode)

      return {
        html: injectPreviewHandshake(cached.html, {
          parentOrigin: options.parentOrigin,
          handshake: options.handshake,
          nonce,
          noncePlaceholder: cached.noncePlaceholder,
        }),
        runtimeMode: cached.runtimeMode,
        nonce,
        cacheKey,
        cacheStatus: 'hit',
      }
    }

    const baseNonce = runtimeMode === 'custom-js' ? null : PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER
    const base = buildPreviewDocument(html, {
      parentOrigin: options.parentOrigin,
      manifest: options.manifest,
      editorBridge: options.editorBridge,
      nonce: baseNonce,
    })
    const entry = cache.set(cacheKey, {
      html: base.html,
      runtimeMode: base.runtimeMode,
      noncePlaceholder: base.nonce ? PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER : null,
    })
    const nonce = createFreshPreviewNonce(base.runtimeMode)

    return {
      html: injectPreviewHandshake(entry.html, {
        parentOrigin: options.parentOrigin,
        handshake: options.handshake,
        nonce,
        noncePlaceholder: entry.noncePlaceholder,
      }),
      runtimeMode: base.runtimeMode,
      nonce,
      cacheKey,
      cacheStatus: 'miss',
    }
  })
}

export function renderPreviewHtml(html: string, options: PreviewHtmlOptions = {}) {
  return withDomEnvironment(() => buildPreviewHtml(html, options))
}
