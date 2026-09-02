/** Head-first generation handshake sentinel injected before deck-authored scripts. */

import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_HANDSHAKE_MESSAGE_TYPE,
} from '../protocol/message-types.ts'
import { getDeckBridgeTargetOrigin } from '../protocol/factories.ts'
import { DECK_HANDSHAKE_RUNTIME_SOURCE } from './generated/handshake.source.ts'
import {
  assembleDeckPreviewRuntimeScript,
  createDeckPreviewRuntimeConstants,
} from './host-constants.ts'

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
  return assembleDeckPreviewRuntimeScript(
    createDeckPreviewRuntimeConstants({
      PROTOCOL_VERSION: DECK_BRIDGE_PROTOCOL_VERSION,
      HANDSHAKE_TYPE: DECK_HANDSHAKE_MESSAGE_TYPE,
      HANDSHAKE: handshake,
      PARENT_ORIGIN: getDeckBridgeTargetOrigin(parentOrigin),
      EDITOR_SESSION_HANDOFF_KEY: editorSessionHandoffKey?.trim() || '',
      SELECTORS: [],
      PREVIEW_MODE: 'css-only',
    }),
    DECK_HANDSHAKE_RUNTIME_SOURCE,
  )
}
