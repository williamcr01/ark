import { SLIDE_SELECTOR_CHAIN, stripDeckScriptsForPreview } from '@/lib/deck-slides'

export const PREVIEW_FRAME_WIDTH = 1600
export const PREVIEW_FRAME_HEIGHT = 900
export const PREVIEW_FRAME_ASPECT_RATIO = `${PREVIEW_FRAME_WIDTH} / ${PREVIEW_FRAME_HEIGHT}`

export const DECK_GOTO_MESSAGE_TYPE = 'ark:deck-goto' as const
export const DECK_SLIDE_CHANGE_MESSAGE_TYPE = 'ark:deck-slide-change' as const

export const DECK_GOTO_EVENT = DECK_GOTO_MESSAGE_TYPE
export const DECK_SLIDE_CHANGE_EVENT = DECK_SLIDE_CHANGE_MESSAGE_TYPE

export type PreviewMode = 'css-only' | 'full-js'

function hasFullJsMarker(doc: Document) {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) {
      continue
    }

    if (element.getAttribute('data-ark-deck') === 'nav') {
      return true
    }

    if (element.getAttribute('data-ark-preview') === 'full-js') {
      return true
    }
  }

  return false
}

export function detectPreviewMode(html: string): PreviewMode {
  if (!html.trim()) {
    return 'css-only'
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return hasFullJsMarker(doc) ? 'full-js' : 'css-only'
}

const previewHistoryShim = `
<script data-ark-preview-history-shim>
(function () {
  function safeHistoryCall(method) {
    var original = history[method];

    if (typeof original !== 'function') {
      return;
    }

    history[method] = function () {
      try {
        return original.apply(history, arguments);
      } catch (error) {}
    };
  }

  safeHistoryCall('replaceState');
  safeHistoryCall('pushState');
})();
</script>`

const previewFillStyle = `
<style data-ark-preview-fill>
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  [data-ark-hidden] {
    display: none !important;
  }

</style>`

const previewBridgeScript = `
<script data-ark-preview-bridge>
(function () {
  var GOTO = ${JSON.stringify(DECK_GOTO_MESSAGE_TYPE)};
  var CHANGE = ${JSON.stringify(DECK_SLIDE_CHANGE_MESSAGE_TYPE)};
  var SELECTORS = ${JSON.stringify([...SLIDE_SELECTOR_CHAIN])};

  function findSlideCount() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var found = document.querySelectorAll(SELECTORS[i]);

      if (found.length) {
        return found.length;
      }
    }

    return 0;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index)) {
      return 0;
    }

    if (count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    var data = event.data;

    if (data && data.type === GOTO && typeof data.index === 'number') {
      document.dispatchEvent(new CustomEvent(GOTO, {
        detail: { index: data.index },
      }));
    }
  });

  document.addEventListener(CHANGE, function (event) {
    var detail = event.detail || {};
    var index = detail.index;
    var count = findSlideCount();
    var clamped = clampIndex(index, count);

    if (window.parent !== window) {
      window.parent.postMessage({ type: CHANGE, index: clamped }, '*');
    }
  });
})();
</script>`

const previewNavScript = `
<script data-ark-preview-nav>
(function () {
  var GOTO = ${JSON.stringify(DECK_GOTO_MESSAGE_TYPE)};
  var CHANGE = ${JSON.stringify(DECK_SLIDE_CHANGE_MESSAGE_TYPE)};
  var SELECTORS = ${JSON.stringify([...SLIDE_SELECTOR_CHAIN])};
  var NAV_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

  var slides = [];
  var currentIndex = 0;
  var hudPadWidth = 0;

  function padNum(n, width) {
    var s = String(n);

    while (s.length < width) {
      s = '0' + s;
    }

    return s;
  }

  function syncCommonHud(index, count) {
    var currentEl = document.getElementById('currentSlide');
    var totalEl = document.getElementById('totalSlides');
    var progressEl = document.getElementById('progressBar');
    var prevEl = document.getElementById('prevSlide');
    var nextEl = document.getElementById('nextSlide');

    if (currentEl) {
      if (!hudPadWidth) {
        var initial = (currentEl.textContent || '').trim();
        hudPadWidth = initial.length > 0 ? initial.length : 2;
      }

      currentEl.textContent = padNum(index + 1, hudPadWidth);
    }

    if (totalEl) {
      var padWidth = hudPadWidth;

      if (!padWidth) {
        var totalInitial = (totalEl.textContent || '').trim();
        padWidth = totalInitial.length > 0 ? totalInitial.length : 2;
      }

      totalEl.textContent = padNum(count, padWidth);
    }

    if (progressEl && count > 0) {
      progressEl.style.width = ((index + 1) / count) * 100 + '%';
    }

    if (prevEl) {
      prevEl.disabled = index === 0;
    }

    if (nextEl) {
      nextEl.disabled = index === count - 1;
    }
  }

  function findSlides() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var found = document.querySelectorAll(SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }

  function showSlide(index) {
    slides = findSlides();

    if (!slides.length) {
      return;
    }

    var nextIndex = Math.max(0, Math.min(slides.length - 1, index));
    currentIndex = nextIndex;

    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var isActive = i === nextIndex;

      if (isActive) {
        slide.removeAttribute('data-ark-hidden');
        slide.setAttribute('data-ark-active', '');
        slide.classList.add('active', 'is-active');
        slide.setAttribute('aria-hidden', 'false');
        slide.setAttribute('data-active', '');
        slide.style.removeProperty('display');

        if (window.getComputedStyle(slide).display === 'none') {
          slide.style.setProperty('display', 'flex', 'important');
        }
      } else {
        slide.removeAttribute('data-ark-active');
        slide.setAttribute('data-ark-hidden', '');
        slide.classList.remove('active', 'is-active');
        slide.setAttribute('aria-hidden', 'true');
        slide.removeAttribute('data-active');
        slide.style.removeProperty('display');
      }
    }

    syncCommonHud(nextIndex, slides.length);

    if (window.parent !== window) {
      window.parent.postMessage({ type: CHANGE, index: nextIndex }, '*');
    }
  }

  function handleNavKey(event) {
    var delta = NAV_KEYS[event.key];

    if (!delta) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showSlide(currentIndex + delta);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    var data = event.data;

    if (data && data.type === GOTO && typeof data.index === 'number') {
      showSlide(data.index);
    }
  });

  document.addEventListener('keydown', handleNavKey, true);
  window.addEventListener('keydown', handleNavKey, true);

  function init() {
    showSlide(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>`

function injectPreviewFill(html: string, options: { historyShim?: boolean } = {}) {
  const headInjection = `${options.historyShim ? `${previewHistoryShim}\n` : ''}${previewFillStyle}`

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${headInjection}\n</head>`)
  }

  return `${headInjection}\n${html}`
}

function injectBeforeBodyClose(html: string, injection: string) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${injection}\n</body>`)
  }

  return `${html}\n${injection}`
}

export function getPreviewHtml(html: string) {
  if (!html) {
    return ''
  }

  const mode = detectPreviewMode(html)

  if (mode === 'full-js') {
    return injectBeforeBodyClose(
      injectPreviewFill(html, { historyShim: true }),
      previewBridgeScript,
    )
  }

  const strippedHtml = stripDeckScriptsForPreview(html)

  return injectBeforeBodyClose(injectPreviewFill(strippedHtml), previewNavScript)
}
