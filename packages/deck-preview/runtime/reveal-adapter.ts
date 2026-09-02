/** Injected Reveal.js navigation adapter for approved registry decks. */

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
  errorListenersChunk,
  findSlidesChunk,
  isRecordAndClampChunk,
  postRuntimeErrorChunk,
  postToParentChunk,
  type DeckBridgeRuntimeScriptOptions,
} from './preamble.ts'

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

${isRecordAndClampChunk}
  function readMetadata() {
    return {
      runtime: 'reveal',
      title: document.title || '',
      previewMode: C.PREVIEW_MODE,
      protocolVersion: C.PROTOCOL_VERSION,
    };
  }

${postToParentChunk}
${postRuntimeErrorChunk}
  function getSlideCount() {
    return window.Reveal && typeof window.Reveal.getTotalSlides === 'function'
      ? window.Reveal.getTotalSlides()
      : 0;
  }

${findSlidesChunk}${buildSlidePatchRuntimeSource()}

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

${errorListenersChunk}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      waitForReveal(0);
    });
  } else {
    waitForReveal(0);
  }
})();`
}
