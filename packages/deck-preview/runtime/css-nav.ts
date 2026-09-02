/** Injected CSS-only navigation shim for script-stripped decks. */

import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
} from '../protocol/message-types.ts'
import {
  buildSlidePatchRuntimeSource,
  detectRuntimeKindChunk,
  errorListenersChunk,
  findSlidesChunk,
  isRecordAndClampChunk,
  postRuntimeErrorChunk,
  postToParentChunk,
  type DeckBridgeRuntimeScriptOptions,
} from './preamble.ts'

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

${isRecordAndClampChunk}
  function padNum(n, width) {
    var s = String(n);

    while (s.length < width) {
      s = '0' + s;
    }

    return s;
  }

${detectRuntimeKindChunk}
${postToParentChunk}
${postRuntimeErrorChunk}
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

${findSlidesChunk}${buildSlidePatchRuntimeSource()}
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

${errorListenersChunk}
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
