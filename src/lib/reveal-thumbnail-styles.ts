import { loadRevealThumbnailStylesFromApi } from '../../shared/runtime-stylesheet-content.ts'

const isVitestEnvironment = typeof process !== 'undefined' && process.env.VITEST === 'true'

if (!isVitestEnvironment) {
  await loadRevealThumbnailStylesFromApi()
}
