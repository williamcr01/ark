import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '@ark/deck-preview'

export const THUMBNAIL_SETTLE_REQUEST_MESSAGE_TYPE = 'ark:thumbnail-settle'
export const THUMBNAIL_SETTLED_MESSAGE_TYPE = 'ark:thumbnail-settled'

const THUMBNAIL_SETTLE_RESPONDER_SOURCE = `(function () {
  var C = __ARK_THUMBNAIL_CONSTANTS__;
  // Thumbnail Electron window navigates this document as a top-level page (not the
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

  // Two frames: the first rAF fires before the compositor paints the frame that
  // carries the slide change; the second rAF can only fire after that frame has
  // been painted. capturePage() reads the latest composited frame, so waiting
  // for a painted frame guarantees the snapshot is never the previous slide.
  function waitForPaintedFrame() {
    return waitForAnimationFrame().then(waitForAnimationFrame);
  }

  function settle() {
    revealFragments();
    finishAnimations();
    return waitForImages()
      .then(waitForFonts)
      .then(waitForPaintedFrame);
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
})();
`

export function buildThumbnailSettleResponderScript(parentOrigin?: string) {
  const constants = {
    READY: DECK_READY_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    REQUEST: THUMBNAIL_SETTLE_REQUEST_MESSAGE_TYPE,
    SETTLED: THUMBNAIL_SETTLED_MESSAGE_TYPE,
    PARENT_ORIGIN: parentOrigin?.trim() || '*',
  }

  return THUMBNAIL_SETTLE_RESPONDER_SOURCE.replace(
    '__ARK_THUMBNAIL_CONSTANTS__',
    JSON.stringify(constants),
  )
}

export function buildThumbnailHostHtml(token: string, parentOrigin: string) {
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
