export type { DeckParseResult } from '@ark/deck/document/parser.ts'
export { parseDeckHtml, type DeckParseOptions } from './document/parser.ts'
export {
  evaluateDeckThemeMatch,
  evaluateThemeSampleHtml,
  readDeckThemeFromHtml,
} from './document/theme-html.ts'
export {
  validateDeckDocumentOnServer,
  validateDeckHtmlOnServer,
  type DeckValidationOptions,
} from './validate/timed.ts'
export {
  applyDeckPatches,
  createDeckDomCache,
  resetDeckDomCache,
  type ApplyDeckPatchesOptions,
} from './patch/slide-ops.ts'
