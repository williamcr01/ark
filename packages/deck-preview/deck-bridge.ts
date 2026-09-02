/**
 * Ark deck runtime bridge protocol.
 *
 * The shell (parent) and sandboxed deck iframe communicate via `postMessage`.
 * Full-JS decks also use DOM `CustomEvent`s inside the iframe; the injected
 * bridge translates between postMessage and those events.
 */

import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_HANDSHAKE_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
} from './protocol/message-types.ts'
import type { DeckPreviewMode } from './protocol/types.ts'
import { getDeckBridgeTargetOrigin } from './protocol/factories.ts'

export * from './protocol/index.ts'

/**
 * Inline head sentinel that posts the generation handshake before deck scripts.
 * Must be injected as the first script in `<head>`.
 *
 * Retries a few times so a parent that attaches its message listener in
 * useLayoutEffect/useEffect after the iframe starts loading still receives the
 * handshake (Present mode remounts are especially race-prone).
 */
export function buildDeckHandshakeSentinelScript(
  handshake: string,
  parentOrigin?: string | null,
  editorSessionHandoffKey?: string | null,
): string {
  const targetOrigin = JSON.stringify(getDeckBridgeTargetOrigin(parentOrigin))
  const handshakeLiteral = JSON.stringify(handshake)
  const handoffKeyLiteral = JSON.stringify(editorSessionHandoffKey?.trim() || '')

  return `(function () {
  var handshake = ${handshakeLiteral};
  var targetOrigin = ${targetOrigin};
  var editorSessionHandoffKey = ${handoffKeyLiteral};
  var ownScript = document.currentScript;
  var parentWindow = window.parent;
  var safeParentPostMessage =
    parentWindow && parentWindow !== window && typeof parentWindow.postMessage === 'function'
      ? parentWindow.postMessage.bind(parentWindow)
      : null;
  var safeSetTimeout = window.setTimeout.bind(window);
  var delays = [0, 0, 50, 200];
  var attempt = 0;

  if (editorSessionHandoffKey) {
    try {
      Object.defineProperty(window, editorSessionHandoffKey, {
        configurable: true,
        value: handshake
      });
    } catch (error) {
      window[editorSessionHandoffKey] = handshake;
    }
  }

  if (ownScript && ownScript.parentNode) {
    ownScript.parentNode.removeChild(ownScript);
  }

  function postHandshake() {
    try {
      if (safeParentPostMessage) {
        safeParentPostMessage({
          type: ${JSON.stringify(DECK_HANDSHAKE_MESSAGE_TYPE)},
          handshake: handshake,
          protocolVersion: ${DECK_BRIDGE_PROTOCOL_VERSION}
        }, targetOrigin);
      }
    } catch (error) {}

    if (attempt >= delays.length - 1) {
      return;
    }

    attempt += 1;
    safeSetTimeout(postHandshake, delays[attempt]);
  }

  postHandshake();
})();`
}

export type DeckBridgeRuntimeScriptOptions = {
  slideSelectors: readonly string[]
  previewMode: DeckPreviewMode
  parentOrigin?: string
}

/**
 * Shared slide-patch applier for the Ark-injected navigation runtimes.
 *
 * Expects a `findSlides()` function in scope. Returns the new slide count, or
 * `null` when the live DOM does not match what the patch assumes — the shell
 * then falls back to a full preview reload.
 */
function buildSlidePatchRuntimeSource() {
  return `
  function arkParseSlide(html) {
    // <template> parses without running scripts or losing <section> context.
    var template = document.createElement('template');
    template.innerHTML = html;
    return template.content.firstElementChild;
  }

  function arkApplySlidePatch(operations) {
    var list = findSlides();

    if (!list.length) {
      return null;
    }

    var parent = list[0].parentNode;

    if (!parent) {
      return null;
    }

    for (var i = 0; i < list.length; i++) {
      if (list[i].parentNode !== parent) {
        return null;
      }
    }

    // Stable anchor for appends: never a slide, so removals cannot detach it.
    var tail = list[list.length - 1].nextSibling;

    for (var o = 0; o < operations.length; o++) {
      var operation = operations[o];

      if (!operation || typeof operation.index !== 'number') {
        return null;
      }

      if (operation.op === 'remove') {
        var removed = list[operation.index];

        if (!removed) {
          return null;
        }

        parent.removeChild(removed);
        list.splice(operation.index, 1);
        continue;
      }

      if (operation.op !== 'insert' || typeof operation.html !== 'string') {
        return null;
      }

      var inserted = arkParseSlide(operation.html);

      if (!inserted || operation.index > list.length) {
        return null;
      }

      parent.insertBefore(inserted, operation.index < list.length ? list[operation.index] : tail);
      list.splice(operation.index, 0, inserted);
    }

    return findSlides().length;
  }
`
}

export function buildDeckBridgeRuntimeScript(options: DeckBridgeRuntimeScriptOptions): string {
  const constants = {
    PROTOCOL_VERSION: DECK_BRIDGE_PROTOCOL_VERSION,
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    READY: DECK_READY_MESSAGE_TYPE,
    SLIDE_COUNT: DECK_SLIDE_COUNT_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    METADATA: DECK_METADATA_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    SELECTORS: [...options.slideSelectors],
    PREVIEW_MODE: options.previewMode,
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
  }

  return `
(function () {
  var C = ${JSON.stringify(constants)};

  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index) || count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }

  function findSlideCount() {
    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return found.length;
      }
    }

    return 0;
  }

  function detectRuntimeKind() {
    if (document.querySelector('.reveal .slides > section')) {
      return 'reveal';
    }

    if (document.querySelector('section.slide')) {
      return 'plain';
    }

    return 'unknown';
  }

  function readMetadata() {
    return {
      runtime: detectRuntimeKind(),
      title: document.title || '',
      previewMode: C.PREVIEW_MODE,
      protocolVersion: C.PROTOCOL_VERSION,
    };
  }

  function postToParent(message) {
    // Always post: thumbnail Electron loads the deck top-level, so parent ===
    // window and the settle script listens for self-posted READY/CHANGE.
    window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
  }

  function postSlideChange(index, slideCount) {
    var clamped = clampIndex(index, slideCount);
    postToParent({ type: C.CHANGE, index: clamped });
  }

  function postReady(index, slideCount) {
    var metadata = readMetadata();
    postToParent({
      type: C.READY,
      index: clampIndex(index, slideCount),
      slideCount: slideCount,
      metadata: metadata,
    });
    postToParent({ type: C.SLIDE_COUNT, slideCount: slideCount });
    postToParent({ type: C.METADATA, metadata: metadata });
  }

  function postRuntimeError(message, source) {
    postToParent({
      type: C.ERROR,
      message: String(message),
      source: source || undefined,
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    if (C.PARENT_ORIGIN && event.origin !== C.PARENT_ORIGIN) {
      return;
    }

    var data = event.data;

    if (isRecord(data) && data.type === C.GOTO && typeof data.index === 'number') {
      document.dispatchEvent(new CustomEvent(C.GOTO, {
        detail: { index: data.index },
      }));
    }
  });

  document.addEventListener(C.CHANGE, function (event) {
    var detail = (event && event.detail) || {};
    var slideCount = findSlideCount();
    postSlideChange(detail.index, slideCount);
  });

  document.addEventListener(C.METADATA, function (event) {
    var detail = (event && event.detail) || {};
    var metadata = detail.metadata;

    if (!isRecord(metadata)) {
      return;
    }

    postToParent({
      type: C.METADATA,
      metadata: {
        runtime: metadata.runtime || 'unknown',
        title: typeof metadata.title === 'string' ? metadata.title : document.title || '',
        previewMode: metadata.previewMode === 'full-js' ? 'full-js' : C.PREVIEW_MODE,
        protocolVersion: C.PROTOCOL_VERSION,
      },
    });
  });

  window.addEventListener('error', function (event) {
    var message = (event && event.message) || 'Deck runtime error';
    var source = event && event.filename ? String(event.filename) : 'window.error';
    postRuntimeError(message, source);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? String(reason.message) : String(reason);
    postRuntimeError(message, 'window.unhandledrejection');
  });

  function announceReady(index) {
    var slideCount = findSlideCount();
    postReady(index, slideCount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      announceReady(0);
    });
  } else {
    announceReady(0);
  }
})();`
}

export function buildDeckCssNavRuntimeScript(options: DeckBridgeRuntimeScriptOptions): string {
  const constants = {
    PROTOCOL_VERSION: DECK_BRIDGE_PROTOCOL_VERSION,
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    PATCH: DECK_PATCH_SLIDES_MESSAGE_TYPE,
    PATCH_RESULT: DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
    READY: DECK_READY_MESSAGE_TYPE,
    SLIDE_COUNT: DECK_SLIDE_COUNT_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    METADATA: DECK_METADATA_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    SELECTORS: [...options.slideSelectors],
    PREVIEW_MODE: options.previewMode,
    NAV_KEYS: { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 },
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
  }

  return `
(function () {
  var C = ${JSON.stringify(constants)};

  var slides = [];
  var currentIndex = 0;
  var hudPadWidth = 0;

  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index) || count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }

  function padNum(n, width) {
    var s = String(n);

    while (s.length < width) {
      s = '0' + s;
    }

    return s;
  }

  function detectRuntimeKind() {
    if (document.querySelector('.reveal .slides > section')) {
      return 'reveal';
    }

    if (document.querySelector('section.slide')) {
      return 'plain';
    }

    return 'unknown';
  }

  function readMetadata() {
    return {
      runtime: detectRuntimeKind(),
      title: document.title || '',
      previewMode: C.PREVIEW_MODE,
      protocolVersion: C.PROTOCOL_VERSION,
    };
  }

  function postToParent(message) {
    // Always post: thumbnail Electron loads the deck top-level, so parent ===
    // window and the settle script listens for self-posted READY/CHANGE.
    window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
  }

  function postRuntimeError(message, source) {
    postToParent({
      type: C.ERROR,
      message: String(message),
      source: source || undefined,
    });
  }

  function postReady(index, slideCount) {
    var metadata = readMetadata();
    var clamped = clampIndex(index, slideCount);
    postToParent({
      type: C.READY,
      index: clamped,
      slideCount: slideCount,
      metadata: metadata,
    });
    postToParent({ type: C.SLIDE_COUNT, slideCount: slideCount });
    postToParent({ type: C.METADATA, metadata: metadata });
  }

  function postSlideChange(index, slideCount) {
    postToParent({ type: C.CHANGE, index: clampIndex(index, slideCount) });
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
    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }
${buildSlidePatchRuntimeSource()}
  function showSlide(index) {
    slides = findSlides();

    if (!slides.length) {
      return;
    }

    var nextIndex = clampIndex(index, slides.length);
    currentIndex = nextIndex;

    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var isActive = i === nextIndex;

      if (isActive) {
        slide.removeAttribute('data-ark-hidden');
        slide.setAttribute('data-ark-active', '');
        slide.classList.add('active', 'is-active', 'present');
        slide.setAttribute('aria-hidden', 'false');
        slide.setAttribute('data-active', '');
        slide.style.removeProperty('display');

        if (window.getComputedStyle(slide).display === 'none') {
          slide.style.setProperty('display', 'flex', 'important');
        }
      } else {
        slide.removeAttribute('data-ark-active');
        slide.setAttribute('data-ark-hidden', '');
        slide.classList.remove('active', 'is-active', 'present');
        slide.setAttribute('aria-hidden', 'true');
        slide.removeAttribute('data-active');
        slide.style.removeProperty('display');
      }
    }

    syncCommonHud(nextIndex, slides.length);
    postSlideChange(nextIndex, slides.length);
  }

  function isTypingTarget(target) {
    if (!target || typeof target !== 'object') {
      return false;
    }

    var element = target;

    if (element.isContentEditable) {
      return true;
    }

    if (element.closest) {
      return Boolean(
        element.closest('[contenteditable="true"], [data-ark-editor-text-edit]'),
      );
    }

    return false;
  }

  function handleNavKey(event) {
    if (
      isTypingTarget(event.target) ||
      document.querySelector('[data-ark-editor-text-edit], [data-ark-editor-selected]')
    ) {
      return;
    }

    var delta = C.NAV_KEYS[event.key];

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

    if (C.PARENT_ORIGIN && event.origin !== C.PARENT_ORIGIN) {
      return;
    }

    var data = event.data;

    if (isRecord(data) && data.type === C.GOTO && typeof data.index === 'number') {
      showSlide(data.index);
      return;
    }

    if (isRecord(data) && data.type === C.PATCH && Array.isArray(data.operations)) {
      var patched = arkApplySlidePatch(data.operations);

      if (patched !== null) {
        slides = findSlides();
        showSlide(typeof data.index === 'number' ? data.index : currentIndex);
        postToParent({ type: C.SLIDE_COUNT, slideCount: slides.length });
      }

      postToParent({
        type: C.PATCH_RESULT,
        patchId: String(data.patchId),
        applied: patched !== null,
        slideCount: patched === null ? 0 : patched,
      });
    }
  });

  document.addEventListener('keydown', handleNavKey, true);
  window.addEventListener('keydown', handleNavKey, true);

  window.addEventListener('error', function (event) {
    var message = (event && event.message) || 'Deck runtime error';
    var source = event && event.filename ? String(event.filename) : 'window.error';
    postRuntimeError(message, source);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? String(reason.message) : String(reason);
    postRuntimeError(message, 'window.unhandledrejection');
  });

  function init() {
    slides = findSlides();
    showSlide(0);
    postReady(currentIndex, slides.length);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`
}

export function buildRevealNavRuntimeScript(options: DeckBridgeRuntimeScriptOptions): string {
  const constants = {
    PROTOCOL_VERSION: DECK_BRIDGE_PROTOCOL_VERSION,
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    PATCH: DECK_PATCH_SLIDES_MESSAGE_TYPE,
    PATCH_RESULT: DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
    READY: DECK_READY_MESSAGE_TYPE,
    SLIDE_COUNT: DECK_SLIDE_COUNT_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    METADATA: DECK_METADATA_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    SELECTORS: [...(options.slideSelectors ?? [])],
    PREVIEW_MODE: options.previewMode,
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
  }

  return `
(function () {
  var C = ${JSON.stringify(constants)};
  var revealReady = false;
  var currentLinearIndex = 0;
  var lastReportedIndex = -1;

  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index) || count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }

  function readMetadata() {
    return {
      runtime: 'reveal',
      title: document.title || '',
      previewMode: C.PREVIEW_MODE,
      protocolVersion: C.PROTOCOL_VERSION,
    };
  }

  function postToParent(message) {
    // Always post: thumbnail Electron loads the deck top-level, so parent ===
    // window and the settle script listens for self-posted READY/CHANGE.
    window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
  }

  function postRuntimeError(message, source) {
    postToParent({
      type: C.ERROR,
      message: String(message),
      source: source || undefined,
    });
  }

  function getSlideCount() {
    return window.Reveal && typeof window.Reveal.getTotalSlides === 'function'
      ? window.Reveal.getTotalSlides()
      : 0;
  }

  function findSlides() {
    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }
${buildSlidePatchRuntimeSource()}

  function getLinearIndex() {
    if (!window.Reveal || typeof window.Reveal.getCurrentSlide !== 'function') {
      return 0;
    }

    var slide = window.Reveal.getCurrentSlide();

    if (!slide || typeof window.Reveal.getSlidePastCount !== 'function') {
      return 0;
    }

    return window.Reveal.getSlidePastCount(slide);
  }

  function postSlideChange(index, slideCount) {
    var clamped = clampIndex(index, slideCount);
    lastReportedIndex = clamped;
    currentLinearIndex = clamped;
    postToParent({ type: C.CHANGE, index: clamped });
    // Deck-authored Chart.js (and similar) init listens for this DOM event to
    // resize canvases after Reveal shows a previously hidden slide.
    document.dispatchEvent(new CustomEvent(C.CHANGE, {
      detail: { index: clamped },
    }));
  }

  function postReady(index, slideCount) {
    var metadata = readMetadata();
    var clamped = clampIndex(index, slideCount);
    lastReportedIndex = clamped;
    currentLinearIndex = clamped;
    postToParent({
      type: C.READY,
      index: clamped,
      slideCount: slideCount,
      metadata: metadata,
    });
    postToParent({ type: C.SLIDE_COUNT, slideCount: slideCount });
    postToParent({ type: C.METADATA, metadata: metadata });
  }

  function gotoLinearIndex(index) {
    if (!revealReady || !window.Reveal) {
      return;
    }

    var slides = typeof window.Reveal.getSlides === 'function' ? window.Reveal.getSlides() : [];

    if (!slides.length) {
      return;
    }

    var clamped = clampIndex(index, slides.length);
    var targetSlide = slides[clamped];
    var indices =
      typeof window.Reveal.getIndices === 'function'
        ? window.Reveal.getIndices(targetSlide)
        : { h: clamped, v: 0, f: 0 };

    window.Reveal.slide(indices.h, indices.v, 0);
  }

  function handleSlideChanged() {
    if (!revealReady || !window.Reveal) {
      return;
    }

    var indices =
      typeof window.Reveal.getIndices === 'function' ? window.Reveal.getIndices() : { f: 0 };

    if (indices.f > 0) {
      return;
    }

    var nextIndex = getLinearIndex();
    var slideCount = getSlideCount();

    if (nextIndex === lastReportedIndex) {
      return;
    }

    postSlideChange(nextIndex, slideCount);
  }

  function bindReveal() {
    if (!window.Reveal || revealReady) {
      return;
    }

    var initResult = window.Reveal.initialize({
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
    });

    function finishReady() {
      revealReady = true;
      window.Reveal.on('slidechanged', handleSlideChanged);
      var index = getLinearIndex();
      var slideCount = getSlideCount();
      postReady(index, slideCount);
    }

    if (initResult && typeof initResult.then === 'function') {
      initResult.then(finishReady).catch(function (error) {
        postRuntimeError(error && error.message ? error.message : String(error), 'reveal.initialize');
      });
      return;
    }

    finishReady();
  }

  function waitForReveal(attempt) {
    if (window.Reveal) {
      bindReveal();
      return;
    }

    if (attempt >= 200) {
      postRuntimeError('Reveal.js failed to load', 'ark:reveal-adapter');
      return;
    }

    window.setTimeout(function () {
      waitForReveal(attempt + 1);
    }, 25);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    if (C.PARENT_ORIGIN && event.origin !== C.PARENT_ORIGIN) {
      return;
    }

    var data = event.data;

    if (isRecord(data) && data.type === C.GOTO && typeof data.index === 'number') {
      gotoLinearIndex(data.index);
      return;
    }

    if (isRecord(data) && data.type === C.PATCH && Array.isArray(data.operations)) {
      // Reveal owns slide layout, so patching before it is initialized would
      // leave the deck unsynced. Report failure and let the shell reload.
      var patched = revealReady ? arkApplySlidePatch(data.operations) : null;

      if (patched !== null) {
        window.Reveal.sync();
        lastReportedIndex = -1;
        gotoLinearIndex(typeof data.index === 'number' ? data.index : getLinearIndex());
        postToParent({ type: C.SLIDE_COUNT, slideCount: getSlideCount() });
        postSlideChange(getLinearIndex(), getSlideCount());
      }

      postToParent({
        type: C.PATCH_RESULT,
        patchId: String(data.patchId),
        applied: patched !== null,
        slideCount: patched === null ? 0 : getSlideCount(),
      });
    }
  });

  window.addEventListener('error', function (event) {
    var message = (event && event.message) || 'Deck runtime error';
    var source = event && event.filename ? String(event.filename) : 'window.error';
    postRuntimeError(message, source);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? String(reason.message) : String(reason);
    postRuntimeError(message, 'window.unhandledrejection');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      waitForReveal(0);
    });
  } else {
    waitForReveal(0);
  }
})();`
}
