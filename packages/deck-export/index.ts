export * from './scene.ts'
export { finalizeSceneSlide, type FinalizeSceneSlideOptions } from './finalize.ts'
export { applyScenePixels, collectScenePixelRequests, type ScenePixelRequest } from './rasterize.ts'
export {
  buildDeckExportLint,
  describeDeckExportLint,
  type DeckExportLint,
  type DeckExportLintEntry,
} from './lint.ts'
export {
  buildDeckSceneExtractorScript,
  DECK_SCENE_EXTRACTOR_GLOBAL,
  type DeckSceneExtractorScriptOptions,
} from './runtime/script.ts'
