import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { JSDOM } from 'jsdom'
import type { NextFunction, Request, Response, Router } from 'express'
import { Router as createRouter } from 'express'

import { buildPreviewDocument, type PreviewDocumentResult } from '@ark/deck-preview/preview-html.ts'
import {
  buildThumbnailHostHtml,
  buildThumbnailSettleResponderScript,
} from './render-host-scripts.ts'
import { buildSandboxResponseCsp } from '@ark/runtime-registry/sandbox-origin.ts'
import { type PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'

/** Header the hidden Electron renderer must send on every render-host request. */
export const THUMBNAIL_RENDER_SECRET_HEADER = 'x-ark-thumbnail-render-secret'
const THUMBNAIL_DISABLE_MOTION_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
.reveal .slides section.present {
  opacity: 1 !important;
  visibility: visible !important;
  transform: none !important;
}
.reveal .fragment {
  opacity: 1 !important;
  visibility: visible !important;
  transform: none !important;
}
`

export function createThumbnailRenderSecret() {
  return randomBytes(32).toString('hex')
}

function secretsMatch(expected: string, provided: string | null | undefined) {
  if (!provided) {
    return false
  }

  // Hash both sides so length differences cannot short-circuit the compare.
  const expectedDigest = createHash('sha256').update(expected).digest()
  const providedDigest = createHash('sha256').update(provided).digest()
  return timingSafeEqual(expectedDigest, providedDigest)
}

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

function ensureDocumentHead(doc: Document) {
  if (doc.head) {
    return doc.head
  }

  const head = doc.createElement('head')
  const root = doc.documentElement

  if (root) {
    root.insertBefore(head, doc.body ?? root.firstChild)
  }

  return head
}

function ensureDocumentBody(doc: Document) {
  if (doc.body) {
    return doc.body
  }

  const body = doc.createElement('body')
  doc.documentElement?.append(body)
  return body
}

function serializeThumbnailPreviewDocument(doc: Document) {
  const root = doc.documentElement?.outerHTML ?? ''
  return root ? `<!DOCTYPE html>\n${root}` : ''
}

function applyThumbnailSettleInstrumentation(
  preview: PreviewDocumentResult,
  options: { parentOrigin?: string } = {},
): PreviewDocumentResult {
  if (!preview.html) {
    return preview
  }

  const dom = new JSDOM(preview.html, { url: 'http://thumbnail.ark.local/' })

  try {
    const doc = dom.window.document
    const head = ensureDocumentHead(doc)
    const body = ensureDocumentBody(doc)
    const style = doc.createElement('style')
    const script = doc.createElement('script')

    style.setAttribute('data-ark-thumbnail-disable-motion', '')
    style.textContent = THUMBNAIL_DISABLE_MOTION_CSS
    head.append(style)

    script.setAttribute('data-ark-thumbnail-settle', '')
    if (preview.nonce) {
      script.setAttribute('nonce', preview.nonce)
    }
    script.textContent = buildThumbnailSettleResponderScript(options.parentOrigin)
    body.insertBefore(script, body.firstChild)

    return {
      ...preview,
      html: serializeThumbnailPreviewDocument(doc),
    }
  } finally {
    dom.window.close()
  }
}

/**
 * Temporarily swaps `globalThis.document`/`DOMParser`/`NodeFilter` for a JSDOM
 * instance so the shared preview builder can run server-side. This is safe for
 * concurrent requests only while `buildPreviewHtml` stays fully synchronous —
 * an `await` between the swap and restore would corrupt the globals for other
 * in-flight requests.
 */
export function renderThumbnailPreviewDocument(
  html: string,
  options: { parentOrigin?: string } = {},
) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://thumbnail.ark.local/',
  })
  const previous = captureDomGlobals()

  globalThis.document = dom.window.document as Document
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser
  globalThis.NodeFilter = dom.window.NodeFilter as typeof NodeFilter

  try {
    const preview = buildPreviewDocument(html, {
      parentOrigin: options.parentOrigin,
      editorBridge: false,
    })

    return applyThumbnailSettleInstrumentation(preview, options)
  } finally {
    restoreDomGlobals(previous)
    dom.window.close()
  }
}

/**
 * The parent origin is derived from the Host header (so ephemeral-port test
 * servers work); parse and re-serialize it through URL so malformed values
 * cannot reach CSP headers or the inline host script.
 */
function resolveRequestOrigin(request: Request): string | null {
  const host = request.get('host')?.trim()

  if (!host) {
    return null
  }

  try {
    const origin = new URL(`${request.protocol}://${host}`).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

function applyThumbnailRenderSecurityHeaders(
  response: Response,
  parentOrigin: string,
  options: { runtimeMode?: 'static' | 'reveal' | 'custom-js'; nonce?: string | null } = {},
) {
  response.setHeader(
    'Content-Security-Policy',
    buildSandboxResponseCsp(parentOrigin, {
      runtimeMode: options.runtimeMode,
      nonce: options.nonce,
    }),
  )
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
  response.removeHeader('Set-Cookie')
}

export function isLoopbackAddress(address: string | null | undefined) {
  if (!address) {
    return false
  }

  if (address === '::1') {
    return true
  }

  // Accept the whole 127/8 loopback block, plus IPv4-mapped IPv6 forms.
  return /^(::ffff:)?127\./i.test(address)
}

/**
 * Only the local hidden Electron window ever needs the thumbnail render routes.
 * Untrusted deck HTML would otherwise be served (and executed) on the API
 * origin for any remote client holding a preview token, weakening the
 * separate-origin isolation model.
 *
 * Loopback alone is not enough: the Vite (and any same-host) reverse proxy
 * makes remote browsers appear as 127.0.0.1 to the API. Require a
 * process-local secret header that only the renderer knows, in addition to
 * the loopback check.
 */
export function createThumbnailRenderAccessGuard(renderSecret: string) {
  return function thumbnailRenderAccessGuard(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response.status(403).send('Thumbnail render routes are only available on loopback.')
      return
    }

    const provided = request.get(THUMBNAIL_RENDER_SECRET_HEADER)

    if (!secretsMatch(renderSecret, provided)) {
      response.status(403).send('Thumbnail render routes require the renderer secret.')
      return
    }

    next()
  }
}

/**
 * Serves deck HTML through the same preview pipeline and sandbox CSP as the
 * sandbox host, but on the API origin so Electron can load approved
 * runtime assets same-origin. A thin host page iframes the deck so the Ark
 * bridge sees a real parent window (matching production preview). Access is
 * restricted to loopback clients that present the process-local render secret
 * (see createThumbnailRenderAccessGuard).
 */
export function createThumbnailRenderRouter(deps: {
  previewSessionStore: PreviewSessionStore
  renderSecret: string
}): Router {
  const { previewSessionStore, renderSecret } = deps
  const router = createRouter()

  router.use('/api/thumbnail-render', createThumbnailRenderAccessGuard(renderSecret))

  router.get(
    '/api/thumbnail-render/:token/host',
    (request: Request<{ token: string }>, response: Response) => {
      const token = request.params.token?.trim()

      if (!token) {
        response.status(400).send('Preview token is required.')
        return
      }

      const session = previewSessionStore.getSession(token)

      if (!session) {
        response.status(404).send('Preview session not found or expired.')
        return
      }

      const parentOrigin = resolveRequestOrigin(request)

      if (!parentOrigin) {
        response.status(400).send('Could not resolve the request origin.')
        return
      }

      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
      )
      response.setHeader('Cache-Control', 'no-store')
      response.type('html').send(buildThumbnailHostHtml(token, parentOrigin))
    },
  )

  router.get(
    '/api/thumbnail-render/:token',
    (request: Request<{ token: string }>, response: Response) => {
      const token = request.params.token?.trim()

      if (!token) {
        response.status(400).send('Preview token is required.')
        return
      }

      const session = previewSessionStore.getSession(token)

      if (!session) {
        response.status(404).send('Preview session not found or expired.')
        return
      }

      const parentOrigin = resolveRequestOrigin(request)

      if (!parentOrigin) {
        response.status(400).send('Could not resolve the request origin.')
        return
      }

      const preview = session.thumbnailPreview
        ? {
            html: session.thumbnailPreview.html,
            runtimeMode: session.thumbnailPreview.runtimeMode,
            nonce: session.thumbnailPreview.nonce,
          }
        : renderThumbnailPreviewDocument(session.html, { parentOrigin })

      applyThumbnailRenderSecurityHeaders(response, parentOrigin, {
        runtimeMode: preview.runtimeMode,
        nonce: preview.nonce,
      })
      response.type('html').send(preview.html)
    },
  )

  return router
}

export function buildThumbnailRenderUrl(apiOrigin: string, token: string) {
  // Navigate Electron to the deck document itself. Capturing an attached iframe
  // session fails on Chrome with "Command can only be executed on top-level targets".
  return `${apiOrigin.replace(/\/+$/, '')}/api/thumbnail-render/${encodeURIComponent(token)}`
}
