/**
 * Ark deck runtime bridge protocol.
 *
 * The shell (parent) and sandboxed deck iframe communicate via `postMessage`.
 * Full-JS decks also use DOM `CustomEvent`s inside the iframe; the injected
 * bridge translates between postMessage and those events.
 *
 * Re-export barrel for existing `@ark/deck-preview/deck-bridge.ts` importers.
 * Wire format lives in `protocol/`; injected iframe scripts live in `runtime/`.
 */

export * from './protocol/index.ts'
export {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
  type DeckBridgeRuntimeScriptOptions,
} from './runtime/index.ts'
