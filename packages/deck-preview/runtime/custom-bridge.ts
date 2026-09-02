/** Injected full-JS custom-deck bridge: postMessage ↔ DOM CustomEvent. */

import { DECK_CUSTOM_BRIDGE_RUNTIME_SOURCE } from './generated/custom-bridge.source.ts'
import {
  assembleDeckPreviewRuntimeScript,
  navRuntimeConstantsFromOptions,
  type DeckBridgeRuntimeScriptOptions,
} from './host-constants.ts'

export function buildDeckBridgeRuntimeScript(options: DeckBridgeRuntimeScriptOptions): string {
  return assembleDeckPreviewRuntimeScript(
    navRuntimeConstantsFromOptions(options),
    DECK_CUSTOM_BRIDGE_RUNTIME_SOURCE,
  )
}
