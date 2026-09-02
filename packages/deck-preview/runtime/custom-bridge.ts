/** Injected full-JS custom-deck bridge: postMessage ↔ DOM CustomEvent. */

import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
} from '../protocol/message-types.ts'
import {
  detectRuntimeKindChunk,
  errorListenersChunk,
  isRecordAndClampChunk,
  postRuntimeErrorChunk,
  postToParentChunk,
  type DeckBridgeRuntimeScriptOptions,
} from './preamble.ts'

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

${isRecordAndClampChunk}
  function findSlideCount() {
    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return found.length;
      }
    }

    return 0;
  }

${detectRuntimeKindChunk}
${postToParentChunk}
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

${postRuntimeErrorChunk}
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

${errorListenersChunk}
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
