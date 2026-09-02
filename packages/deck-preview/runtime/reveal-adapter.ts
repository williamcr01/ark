/** Injected Reveal.js navigation adapter for approved registry decks. */

import { DECK_REVEAL_ADAPTER_RUNTIME_SOURCE } from './generated/reveal-adapter.source.ts'
import {
  assembleDeckPreviewRuntimeScript,
  navRuntimeConstantsFromOptions,
  type DeckBridgeRuntimeScriptOptions,
} from './host-constants.ts'

export function buildRevealNavRuntimeScript(options: DeckBridgeRuntimeScriptOptions): string {
  return assembleDeckPreviewRuntimeScript(
    navRuntimeConstantsFromOptions(options),
    DECK_REVEAL_ADAPTER_RUNTIME_SOURCE,
  )
}
