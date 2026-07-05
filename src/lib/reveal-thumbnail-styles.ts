import { loadRevealThumbnailStylesFromApi } from '../../shared/runtime-stylesheet-content.ts'

const isVitestEnvironment = typeof process !== 'undefined' && process.env.VITEST === 'true'
const isBrowser = typeof window !== 'undefined'

if (isBrowser && !isVitestEnvironment) {
  await loadRevealThumbnailStylesFromApi()
}
