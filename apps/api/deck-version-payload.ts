import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'
import { buildDeckRuntimeManifestFromValidation } from './deck-manifest.ts'
import type { DeckVersionOptions } from './deck-record.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'

export function buildDeckVersionOptions(
  html: string,
  base: DeckVersionOptions = {},
  validation: DeckValidationReport = validateDeckHtmlOnServer(html),
): DeckVersionOptions {
  const runtimeManifest = buildDeckRuntimeManifestFromValidation(html, validation)

  return {
    ...base,
    validationStatus: validation.valid ? 'valid' : 'invalid',
    runtimeManifest,
    validationReport: validation,
  }
}

export function mergeDeckVersionOptions(
  html: string,
  base: DeckVersionOptions,
  validation?: DeckValidationReport,
): DeckVersionOptions {
  const resolvedValidation = validation ?? validateDeckHtmlOnServer(html)

  return buildDeckVersionOptions(html, base, resolvedValidation)
}
