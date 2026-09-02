/** Shared injected-script snippets for the deck iframe runtimes. */

import type { DeckPreviewMode } from '../protocol/types.ts'

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
export function buildSlidePatchRuntimeSource() {
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

/** Shared `isRecord` / `clampIndex` helpers used by every injected runtime. */
export const isRecordAndClampChunk = `  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index) || count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }
`

/** Shared runtime-kind detection used by the CSS-nav and custom-JS bridges. */
export const detectRuntimeKindChunk = `  function detectRuntimeKind() {
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
`

/** Shared parent postMessage helper. */
export const postToParentChunk = `  function postToParent(message) {
    // Always post: thumbnail Electron loads the deck top-level, so parent ===
    // window and the settle script listens for self-posted READY/CHANGE.
    window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
  }
`

/** Shared runtime-error reporter. */
export const postRuntimeErrorChunk = `  function postRuntimeError(message, source) {
    postToParent({
      type: C.ERROR,
      message: String(message),
      source: source || undefined,
    });
  }
`

/** Shared slide query used by the CSS-nav shim and the reveal adapter. */
export const findSlidesChunk = `  function findSlides() {
    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }
`

/** Shared window error / unhandledrejection forwarding. */
export const errorListenersChunk = `  window.addEventListener('error', function (event) {
    var message = (event && event.message) || 'Deck runtime error';
    var source = event && event.filename ? String(event.filename) : 'window.error';
    postRuntimeError(message, source);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? String(reason.message) : String(reason);
    postRuntimeError(message, 'window.unhandledrejection');
  });
`
