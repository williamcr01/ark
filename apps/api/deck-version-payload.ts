import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'
import { buildDeckRuntimeManifestFromValidation } from './deck-manifest.ts'
import { hashRuntimeManifest } from './deck-provenance.ts'
import type { DeckVersionOptions } from './deck-record.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'

function withRuntimeManifestHash(
  options: DeckVersionOptions,
  runtimeManifest: NonNullable<DeckVersionOptions['runtimeManifest']>,
): DeckVersionOptions {
  const runtimeManifestHash = hashRuntimeManifest(runtimeManifest)
  const provenance = {
    ...(options.provenance ?? {}),
    runtimeManifestHash,
  }

  return {
    ...options,
    runtimeManifest,
    provenance,
  }
}

export function buildDeckVersionOptions(
  html: string,
  base: DeckVersionOptions = {},
  validation: DeckValidationReport = validateDeckHtmlOnServer(html),
): DeckVersionOptions {
  const runtimeManifest = buildDeckRuntimeManifestFromValidation(html, validation)

  return withRuntimeManifestHash(
    {
      ...base,
      validationStatus: validation.valid ? 'valid' : 'invalid',
      runtimeManifest,
      validationReport: validation,
    },
    runtimeManifest,
  )
}

export function mergeDeckVersionOptions(
  html: string,
  base: DeckVersionOptions,
  validation?: DeckValidationReport,
): DeckVersionOptions {
  const resolvedValidation = validation ?? validateDeckHtmlOnServer(html)

  return buildDeckVersionOptions(html, base, resolvedValidation)
}
