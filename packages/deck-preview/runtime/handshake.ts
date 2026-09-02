/** Head-first generation handshake sentinel injected before deck-authored scripts. */

import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_HANDSHAKE_MESSAGE_TYPE,
} from '../protocol/message-types.ts'
import { getDeckBridgeTargetOrigin } from '../protocol/factories.ts'

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
