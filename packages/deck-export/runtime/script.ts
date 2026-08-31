/**
 * Assembles the scene extractor injected into the render window.
 *
 * The script installs one function and returns nothing; the host then calls
 * `window.__arkExtractScene(index)` once per settled slide. Injecting once and
 * calling per slide keeps the parse cost off every slide of a long deck.
 */

import { SLIDE_SELECTOR_CHAIN } from '@ark/deck/document/slides.ts'

import { SCENE_FRAME_HEIGHT, SCENE_FRAME_WIDTH } from '../scene.ts'
import { geometryChunk } from './geometry.ts'
import { textChunk } from './text.ts'
import { valuesChunk } from './values.ts'
import { walkChunk } from './walk.ts'

/** The global the host calls once per settled slide. */
export const DECK_SCENE_EXTRACTOR_GLOBAL = '__arkExtractScene'

export type DeckSceneExtractorScriptOptions = {
  /** Defaults to the shared preview slide-selector chain. */
  slideSelectors?: readonly string[]
}

export function buildDeckSceneExtractorScript(
  options: DeckSceneExtractorScriptOptions = {},
): string {
  const slideSelectors = options.slideSelectors ?? SLIDE_SELECTOR_CHAIN

  return `(function () {
  var SLIDE_SELECTORS = ${JSON.stringify(slideSelectors)};
  var FRAME_WIDTH = ${SCENE_FRAME_WIDTH};
  var FRAME_HEIGHT = ${SCENE_FRAME_HEIGHT};
${valuesChunk}
${geometryChunk}
${textChunk}
${walkChunk}
  window.${DECK_SCENE_EXTRACTOR_GLOBAL} = function (index) {
    try {
      return extractScene(Number(index) || 0);
    } catch (error) {
      return {
        index: Number(index) || 0,
        background: { type: 'none' },
        nodes: [],
        notes: null,
        warnings: [
          {
            code: 'extract-failed',
            message: 'Scene extraction failed: ' + (error && error.message ? error.message : error),
            count: 1,
          },
        ],
      };
    }
  };
})();`
}
