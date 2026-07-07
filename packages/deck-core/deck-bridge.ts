/**
 * Ark deck runtime bridge protocol.
 *
 * The shell (parent) and sandboxed deck iframe communicate via `postMessage`.
 * Full-JS decks also use DOM `CustomEvent`s inside the iframe; the injected
 * bridge translates between postMessage and those events.
 */

export const DECK_BRIDGE_PROTOCOL_VERSION = 1 as const

export const DECK_GOTO_MESSAGE_TYPE = 'ark:deck-goto' as const
export const DECK_READY_MESSAGE_TYPE = 'ark:deck-ready' as const
export const DECK_SLIDE_COUNT_MESSAGE_TYPE = 'ark:deck-slide-count' as const
export const DECK_SLIDE_CHANGE_MESSAGE_TYPE = 'ark:deck-slide-change' as const
export const DECK_METADATA_MESSAGE_TYPE = 'ark:deck-metadata' as const
export const DECK_RUNTIME_ERROR_MESSAGE_TYPE = 'ark:deck-runtime-error' as const

export const DECK_GOTO_EVENT = DECK_GOTO_MESSAGE_TYPE
export const DECK_SLIDE_CHANGE_EVENT = DECK_SLIDE_CHANGE_MESSAGE_TYPE
export const DECK_METADATA_EVENT = DECK_METADATA_MESSAGE_TYPE

export const DECK_BRIDGE_MESSAGE_TYPES = [
  DECK_GOTO_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
] as const

export type DeckBridgeMessageType = (typeof DECK_BRIDGE_MESSAGE_TYPES)[number]

export type DeckRuntimeKind = 'plain' | 'reveal' | 'unknown'

export type DeckPreviewMode = 'css-only' | 'full-js'

export type PreviewMode = DeckPreviewMode

export type DeckMetadata = {
  runtime: DeckRuntimeKind
  title: string
  previewMode: DeckPreviewMode
  protocolVersion: typeof DECK_BRIDGE_PROTOCOL_VERSION
}

export type DeckGotoMessage = {
  type: typeof DECK_GOTO_MESSAGE_TYPE
  index: number
}

export type DeckReadyMessage = {
  type: typeof DECK_READY_MESSAGE_TYPE
  index: number
  slideCount: number
  metadata: DeckMetadata
}

export type DeckSlideCountMessage = {
  type: typeof DECK_SLIDE_COUNT_MESSAGE_TYPE
  slideCount: number
}

export type DeckSlideChangeMessage = {
  type: typeof DECK_SLIDE_CHANGE_MESSAGE_TYPE
  index: number
}

export type DeckMetadataMessage = {
  type: typeof DECK_METADATA_MESSAGE_TYPE
  metadata: DeckMetadata
}

export type DeckRuntimeErrorMessage = {
  type: typeof DECK_RUNTIME_ERROR_MESSAGE_TYPE
  message: string
  source?: string
}

export type DeckBridgeMessage =
  | DeckGotoMessage
  | DeckReadyMessage
  | DeckSlideCountMessage
  | DeckSlideChangeMessage
  | DeckMetadataMessage
  | DeckRuntimeErrorMessage

export type DeckBridgeMessageFromRuntime = Exclude<DeckBridgeMessage, DeckGotoMessage>

const DECK_BRIDGE_MESSAGE_TYPE_SET = new Set<string>(DECK_BRIDGE_MESSAGE_TYPES)

export function isDeckBridgeMessageType(value: unknown): value is DeckBridgeMessageType {
  return typeof value === 'string' && DECK_BRIDGE_MESSAGE_TYPE_SET.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDeckRuntimeKind(value: unknown): value is DeckRuntimeKind {
  return value === 'plain' || value === 'reveal' || value === 'unknown'
}

function isDeckPreviewMode(value: unknown): value is DeckPreviewMode {
  return value === 'css-only' || value === 'full-js'
}

export function isDeckMetadata(value: unknown): value is DeckMetadata {
  if (!isRecord(value)) {
    return false
  }

  return (
    isDeckRuntimeKind(value.runtime) &&
    typeof value.title === 'string' &&
    isDeckPreviewMode(value.previewMode) &&
    value.protocolVersion === DECK_BRIDGE_PROTOCOL_VERSION
  )
}

export function isDeckGotoMessage(value: unknown): value is DeckGotoMessage {
  return isRecord(value) && value.type === DECK_GOTO_MESSAGE_TYPE && isFiniteNumber(value.index)
}

export function isDeckReadyMessage(value: unknown): value is DeckReadyMessage {
  return (
    isRecord(value) &&
    value.type === DECK_READY_MESSAGE_TYPE &&
    isFiniteNumber(value.index) &&
    isFiniteNumber(value.slideCount) &&
    isDeckMetadata(value.metadata)
  )
}

export function isDeckSlideCountMessage(value: unknown): value is DeckSlideCountMessage {
  return (
    isRecord(value) &&
    value.type === DECK_SLIDE_COUNT_MESSAGE_TYPE &&
    isFiniteNumber(value.slideCount)
  )
}

export function isDeckSlideChangeMessage(value: unknown): value is DeckSlideChangeMessage {
  return (
    isRecord(value) && value.type === DECK_SLIDE_CHANGE_MESSAGE_TYPE && isFiniteNumber(value.index)
  )
}

export function isDeckMetadataMessage(value: unknown): value is DeckMetadataMessage {
  return (
    isRecord(value) && value.type === DECK_METADATA_MESSAGE_TYPE && isDeckMetadata(value.metadata)
  )
}

export function isDeckRuntimeErrorMessage(value: unknown): value is DeckRuntimeErrorMessage {
  return (
    isRecord(value) &&
    value.type === DECK_RUNTIME_ERROR_MESSAGE_TYPE &&
    typeof value.message === 'string' &&
    (value.source === undefined || typeof value.source === 'string')
  )
}

export function isDeckBridgeMessage(value: unknown): value is DeckBridgeMessage {
  return (
    isDeckGotoMessage(value) ||
    isDeckReadyMessage(value) ||
    isDeckSlideCountMessage(value) ||
    isDeckSlideChangeMessage(value) ||
    isDeckMetadataMessage(value) ||
    isDeckRuntimeErrorMessage(value)
  )
}

export function isDeckBridgeMessageFromRuntime(
  value: unknown,
): value is DeckBridgeMessageFromRuntime {
  return isDeckBridgeMessage(value) && value.type !== DECK_GOTO_MESSAGE_TYPE
}

export function parseDeckBridgeMessage(value: unknown): DeckBridgeMessage | null {
  return isDeckBridgeMessage(value) ? value : null
}

export function clampDeckSlideIndex(index: number, slideCount: number) {
  if (!Number.isFinite(index) || slideCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(slideCount - 1, Math.floor(index)))
}

export function createDeckMetadata(
  input: Partial<DeckMetadata> & Pick<DeckMetadata, 'previewMode'>,
): DeckMetadata {
  return {
    runtime: input.runtime ?? 'unknown',
    title: input.title ?? '',
    previewMode: input.previewMode,
    protocolVersion: DECK_BRIDGE_PROTOCOL_VERSION,
  }
}

export function createDeckGotoMessage(index: number): DeckGotoMessage {
  return { type: DECK_GOTO_MESSAGE_TYPE, index }
}

export function createDeckReadyMessage(
  index: number,
  slideCount: number,
  metadata: DeckMetadata,
): DeckReadyMessage {
  return {
    type: DECK_READY_MESSAGE_TYPE,
    index,
    slideCount,
    metadata,
  }
}

export function createDeckSlideCountMessage(slideCount: number): DeckSlideCountMessage {
  return { type: DECK_SLIDE_COUNT_MESSAGE_TYPE, slideCount }
}

export function createDeckSlideChangeMessage(index: number): DeckSlideChangeMessage {
  return { type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index }
}

export function createDeckMetadataMessage(metadata: DeckMetadata): DeckMetadataMessage {
  return { type: DECK_METADATA_MESSAGE_TYPE, metadata }
}

export function createDeckRuntimeErrorMessage(
  message: string,
  source?: string,
): DeckRuntimeErrorMessage {
  return {
    type: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    message,
    ...(source ? { source } : {}),
  }
}

export const DECK_BRIDGE_TARGET_ORIGIN = '*' as const

export function getDeckBridgeTargetOrigin(parentOrigin?: string | null) {
  const configured = parentOrigin?.trim()

  if (configured) {
    return configured
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  return DECK_BRIDGE_TARGET_ORIGIN
}

export function postDeckGoto(
  target: Window,
  index: number,
  targetOrigin = DECK_BRIDGE_TARGET_ORIGIN,
) {
  target.postMessage(createDeckGotoMessage(index), targetOrigin)
}

export function postDeckBridgeMessage(
  target: Window,
  message: DeckBridgeMessageFromRuntime,
  targetOrigin = DECK_BRIDGE_TARGET_ORIGIN,
) {
  target.postMessage(message, targetOrigin)
}

export type DeckBridgeRuntimeScriptOptions = {
  slideSelectors: readonly string[]
  previewMode: DeckPreviewMode
  parentOrigin?: string
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
    if (window.parent !== window) {
      window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
    }
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
    if (window.parent !== window) {
      window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
    }
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
    if (isTypingTarget(event.target) || document.querySelector('[data-ark-editor-text-edit]')) {
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
    READY: DECK_READY_MESSAGE_TYPE,
    SLIDE_COUNT: DECK_SLIDE_COUNT_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    METADATA: DECK_METADATA_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
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
    if (window.parent !== window) {
      window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
    }
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
