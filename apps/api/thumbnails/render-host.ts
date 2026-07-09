import { JSDOM } from 'jsdom'
import type { NextFunction, Request, Response, Router } from 'express'
import { Router as createRouter } from 'express'

import { buildPreviewHtml } from '@ark/deck-core/deck-preview-html.ts'
import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '@ark/deck-core/deck-bridge.ts'
import { buildSandboxResponseCsp } from '@ark/runtime-registry/sandbox-origin.ts'
import { type PreviewSessionStore } from '../preview-sessions.ts'

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

export function renderThumbnailPreviewHtml(html: string, options: { parentOrigin?: string } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://thumbnail.ark.local/',
  })
  const previous = captureDomGlobals()

  globalThis.document = dom.window.document as Document
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser
  globalThis.NodeFilter = dom.window.NodeFilter as typeof NodeFilter

  try {
    return buildPreviewHtml(html, {
      parentOrigin: options.parentOrigin,
      editorBridge: false,
    })
  } finally {
    restoreDomGlobals(previous)
    dom.window.close()
  }
}

function applyThumbnailRenderSecurityHeaders(response: Response, parentOrigin: string) {
  response.setHeader('Content-Security-Policy', buildSandboxResponseCsp(parentOrigin))
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
  });

  window.__arkThumbGoto = function (index) {
    var frame = document.getElementById('ark-thumb-frame');
    if (!frame || !frame.contentWindow) {
      return false;
    }

    frame.contentWindow.postMessage({ type: C.GOTO, index: index }, '*');
    return true;
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
 * separate-origin isolation model — so reject anything that is not loopback.
 */
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
 * restricted to loopback clients (see thumbnailRenderLoopbackGuard).
 */
export function createThumbnailRenderRouter(deps: {
  previewSessionStore: PreviewSessionStore
}): Router {
  const { previewSessionStore } = deps
  const router = createRouter()

  router.use('/api/thumbnail-render', thumbnailRenderLoopbackGuard)

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

      const parentOrigin = `${request.protocol}://${request.get('host')}`
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

      const parentOrigin = `${request.protocol}://${request.get('host')}`
      const previewHtml = renderThumbnailPreviewHtml(session.html, { parentOrigin })

      applyThumbnailRenderSecurityHeaders(response, parentOrigin)
      response.type('html').send(previewHtml)
    },
  )

  return router
}

export function buildThumbnailRenderUrl(apiOrigin: string, token: string) {
  return `${apiOrigin.replace(/\/+$/, '')}/api/thumbnail-render/${encodeURIComponent(token)}/host`
}
