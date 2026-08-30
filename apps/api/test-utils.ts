import type { DeckValidationReport } from '@ark/deck/validate/document.ts'
import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'

export const stubStaticRuntimeManifest = {
  schemaVersion: 1,
  runtimeMode: 'static',
  previewMode: 'css-only',
  structure: 'plain',
  slideSelector: 'section.slide',
  slideCount: 1,
  aspectRatio: '16:9',
  scripts: { inline: 0, external: 0, allowed: false },
  assets: [],
  network: { externalUrls: [], connectAllowed: false },
  validation: { valid: true, warnings: 0, errors: 0 },
  usesRevealAdapter: false,
  warnings: [],
} satisfies DeckRuntimeManifest

export const stubValidDeckValidation = {
  valid: true,
  slideCount: 1,
  scripts: [],
  forms: 0,
  iframes: 0,
  externalUrls: [],
  malformedSlides: [],
  runtimeMarkers: {
    runtimeMode: 'static',
    arkDeck: null,
    arkPreview: null,
    arkRuntime: null,
    arkRuntimeLib: null,
    arkRuntimeVersion: null,
    approvedRuntimeId: null,
    approvedRuntimeVersion: null,
  },
  issues: [],
} satisfies DeckValidationReport
