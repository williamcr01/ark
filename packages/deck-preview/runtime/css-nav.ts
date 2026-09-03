/** Injected CSS-only navigation shim for script-stripped decks. */

import { DECK_CSS_NAV_RUNTIME_SOURCE } from './generated/css-nav.source.ts'
import {
  assembleDeckPreviewRuntimeScript,
  navRuntimeConstantsFromOptions,
  type DeckBridgeRuntimeScriptOptions,
} from './host-constants.ts'

export function buildDeckCssNavRuntimeScript(options: DeckBridgeRuntimeScriptOptions): string {
  return assembleDeckPreviewRuntimeScript(
    navRuntimeConstantsFromOptions(options),
    DECK_CSS_NAV_RUNTIME_SOURCE,
  )
}
