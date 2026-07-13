import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { JSDOM } from 'jsdom'
import type { NextFunction, Request, Response, Router } from 'express'
import { Router as createRouter } from 'express'

import {
  buildPreviewDocument,
  type PreviewDocumentResult,
} from '@ark/deck-core/deck-preview-html.ts'
import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '@ark/deck-core/deck-bridge.ts'
import { buildSandboxResponseCsp } from '@ark/runtime-registry/sandbox-origin.ts'
import { type PreviewSessionStore } from '../preview-sessions.ts'

/** Header the headless Chromium renderer must send on every render-host request. */
export const THUMBNAIL_RENDER_SECRET_HEADER = 'x-ark-thumbnail-render-secret'
const THUMBNAIL_SETTLE_REQUEST_MESSAGE_TYPE = 'ark:thumbnail-settle'
const THUMBNAIL_SETTLED_MESSAGE_TYPE = 'ark:thumbnail-settled'
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

function buildThumbnailSettleResponderScript(parentOrigin?: string) {
  const constants = {
    READY: DECK_READY_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    REQUEST: THUMBNAIL_SETTLE_REQUEST_MESSAGE_TYPE,
    SETTLED: THUMBNAIL_SETTLED_MESSAGE_TYPE,
    PARENT_ORIGIN: parentOrigin?.trim() || '*',
  }

  return `(function () {
  var C = ${JSON.stringify(constants)};
  // Thumbnail Chromium navigates this document as a top-level page (not the
  // host iframe) so Page.captureScreenshot is allowed. Expose the same control
  // surface the host page used to provide.
  window.__arkThumbReady = false;
  window.__arkThumbSlideCount = 0;
  window.__arkThumbIndex = 0;
  window.__arkThumbErrors = [];
  window.__arkThumbSettleRequestId = 0;
  window.__arkThumbSettledRequestId = 0;
  window.__arkThumbSettledIndex = -1;

  function revealFragments() {
    try {
      var fragments = document.querySelectorAll('.reveal .fragment');
      for (var i = 0; i < fragments.length; i += 1) {
        fragments[i].classList.add('visible');
      }
    } catch (error) {}
  }

  function finishAnimations() {
    try {
      var animations = document.getAnimations();
      for (var i = 0; i < animations.length; i += 1) {
        try {
          animations[i].finish();
        } catch (error) {}
      }
    } catch (error) {}
  }

  function waitForImages() {
    var images = Array.prototype.slice.call(document.images || []);
    return Promise.all(images.map(function (img) {
      function decodeIfPossible() {
        if (typeof img.decode === 'function') {
          return img.decode().catch(function () {});
        }
        return Promise.resolve();
      }

      if (img.complete) {
        return decodeIfPossible();
      }

      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }).then(decodeIfPossible);
    }));
  }

  function waitForFonts() {
    try {
      if (document.fonts && document.fonts.ready) {
        return document.fonts.ready.catch(function () {});
      }
    } catch (error) {}

    return Promise.resolve();
  }

  function waitForAnimationFrame() {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
          resolve();
        });
        return;
      }

      setTimeout(resolve, 0);
    });
  }

  function settle() {
    revealFragments();
    finishAnimations();
    return waitForImages()
      .then(waitForFonts)
      .then(waitForAnimationFrame);
  }

  window.addEventListener('message', function (event) {
    // Top-level render: bridge posts to window.parent === window.
    // Hosted render: parent is the thumbnail host frame.
    if (event.source !== window.parent && event.source !== window) {
      return;
    }

    var data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === C.READY) {
      window.__arkThumbReady = true;
      window.__arkThumbSlideCount = typeof data.slideCount === 'number' ? data.slideCount : 0;
      window.__arkThumbIndex = typeof data.index === 'number' ? data.index : 0;
      return;
    }

    if (data.type === C.CHANGE && typeof data.index === 'number') {
      window.__arkThumbIndex = data.index;
      return;
    }

    if (data.type === C.ERROR) {
      window.__arkThumbErrors.push(String(data.message || 'Deck runtime error'));
      return;
    }

    if (data.type !== C.REQUEST) {
      return;
    }

    var requestId = Number(data.requestId);
    var index = Number(data.index);
    if (!Number.isFinite(requestId)) {
      return;
    }

    settle().then(function () {
      window.__arkThumbSettledRequestId = requestId;
      window.__arkThumbSettledIndex = Number.isFinite(index) ? index : -1;
      window.parent.postMessage({
        type: C.SETTLED,
        requestId: requestId,
        index: Number.isFinite(index) ? index : -1
      }, C.PARENT_ORIGIN);
    });
  });

  window.__arkThumbGoto = function (index) {
    // Bridge accepts GOTO when event.source === window.parent; top-level
    // parent is this window, so a self-postMessage is accepted.
    window.postMessage({ type: C.GOTO, index: index }, '*');
    return true;
  };

  window.__arkThumbRequestSettle = function (index) {
    window.__arkThumbSettleRequestId += 1;
    var requestId = window.__arkThumbSettleRequestId;
    settle().then(function () {
      window.__arkThumbSettledRequestId = requestId;
      window.__arkThumbSettledIndex = index;
    });
    return requestId;
  };
})();`
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

/** @deprecated Prefer {@link renderThumbnailPreviewDocument} when CSP headers need the nonce. */
export function renderThumbnailPreviewHtml(html: string, options: { parentOrigin?: string } = {}) {
  return renderThumbnailPreviewDocument(html, options).html
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

function buildThumbnailHostHtml(token: string, parentOrigin: string) {
  const frameSrc = `/api/thumbnail-render/${encodeURIComponent(token)}`
  const constants = {
    READY: DECK_READY_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    SETTLE: THUMBNAIL_SETTLE_REQUEST_MESSAGE_TYPE,
    SETTLED: THUMBNAIL_SETTLED_MESSAGE_TYPE,
    PARENT_ORIGIN: parentOrigin,
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ark thumbnail host</title>
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #fff;
    }
    iframe {
      border: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
  </style>
</head>
<body>
  <iframe id="ark-thumb-frame" sandbox="allow-scripts" src="${frameSrc}" title="Deck thumbnail render"></iframe>
  <script>
(function () {
  var C = ${JSON.stringify(constants)};
  window.__arkThumbReady = false;
  window.__arkThumbSlideCount = 0;
  window.__arkThumbIndex = 0;
  window.__arkThumbErrors = [];
  window.__arkThumbSettleRequestId = 0;
  window.__arkThumbSettledRequestId = 0;
  window.__arkThumbSettledIndex = -1;

  window.addEventListener('message', function (event) {
    var frame = document.getElementById('ark-thumb-frame');
    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    var data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === C.READY) {
      window.__arkThumbReady = true;
      window.__arkThumbSlideCount = typeof data.slideCount === 'number' ? data.slideCount : 0;
      window.__arkThumbIndex = typeof data.index === 'number' ? data.index : 0;
    }

    if (data.type === C.CHANGE && typeof data.index === 'number') {
      window.__arkThumbIndex = data.index;
    }

    if (data.type === C.ERROR) {
      window.__arkThumbErrors.push(String(data.message || 'Deck runtime error'));
    }

    if (data.type === C.SETTLED && typeof data.requestId === 'number') {
      window.__arkThumbSettledRequestId = data.requestId;
      window.__arkThumbSettledIndex = typeof data.index === 'number' ? data.index : -1;
    }
  });

  window.__arkThumbGoto = function (index) {
    var frame = document.getElementById('ark-thumb-frame');
    if (!frame || !frame.contentWindow) {
      return false;
    }

    frame.contentWindow.postMessage({ type: C.GOTO, index: index }, '*');
    return true;
  };

  window.__arkThumbRequestSettle = function (index) {
    var frame = document.getElementById('ark-thumb-frame');
    if (!frame || !frame.contentWindow) {
      return null;
    }

    window.__arkThumbSettleRequestId += 1;
    frame.contentWindow.postMessage({
      type: C.SETTLE,
      requestId: window.__arkThumbSettleRequestId,
      index: index
    }, '*');
    return window.__arkThumbSettleRequestId;
  };
})();
  </script>
</body>
</html>`
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
 * Only the local headless Chromium ever needs the thumbnail render routes.
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

/** @deprecated Prefer createThumbnailRenderAccessGuard — kept for older call sites/tests. */
export function thumbnailRenderLoopbackGuard(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).send('Thumbnail render routes are only available on loopback.')
    return
  }

  next()
}

/**
 * Serves deck HTML through the same preview pipeline and sandbox CSP as the
 * sandbox host, but on the API origin so headless Chromium can load approved
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
  // Navigate Chromium to the deck document itself. Capturing an attached iframe
  // session fails on Chrome with "Command can only be executed on top-level targets".
  return `${apiOrigin.replace(/\/+$/, '')}/api/thumbnail-render/${encodeURIComponent(token)}`
}
