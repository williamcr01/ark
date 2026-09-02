import {
  type ApprovedRuntimeEntry,
  type DeckRuntimeAddonMarkers,
  type DeckRuntimeLibraryMarkers,
  RUNTIME_ASSET_API_PREFIX,
  getApprovedRuntime,
  lookupRuntimeAsset,
  parseRuntimeAssetUrl,
} from './deck-runtime-registry.ts'

export type RuntimeAssetValidationIssue = {
  code: 'unapproved_runtime_asset' | 'runtime_version_mismatch' | 'missing_runtime_assets'
  message: string
  severity: 'error'
}

export function collectRuntimeAssetReferences(doc: Document) {
  const refs = new Set<string>()

  for (const element of doc.querySelectorAll('[src], [href], link[rel="stylesheet"]')) {
    for (const attribute of ['src', 'href'] as const) {
      const value = element.getAttribute(attribute)

      if (value?.startsWith(`${RUNTIME_ASSET_API_PREFIX}/`)) {
        refs.add(value.trim())
      }
    }
  }

  return [...refs].sort()
}

function collectDeclaredDeckRuntimes(
  libraryMarkers: DeckRuntimeLibraryMarkers,
  addonMarkers: DeckRuntimeAddonMarkers,
) {
  const runtimes: ApprovedRuntimeEntry[] = []

  if (libraryMarkers.arkRuntimeLib && libraryMarkers.arkRuntimeVersion) {
    const runtime = getApprovedRuntime(
      libraryMarkers.arkRuntimeLib,
      libraryMarkers.arkRuntimeVersion,
    )

    if (runtime) {
      runtimes.push(runtime)
    }
  }

  if (addonMarkers.arkRuntimeAddonLib && addonMarkers.arkRuntimeAddonVersion) {
    const runtime = getApprovedRuntime(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )

    if (runtime && !runtimes.some((entry) => entry.id === runtime.id)) {
      runtimes.push(runtime)
    }
  }

  return runtimes
}

function runtimeMatchesDeclaredVersion(
  runtimeId: string,
  version: string,
  declaredRuntimes: ApprovedRuntimeEntry[],
) {
  return declaredRuntimes.some((runtime) => runtime.id === runtimeId && runtime.version === version)
}

function isIncompleteRuntimeMarkerPair(library: string | null, version: string | null) {
  return Boolean(library) !== Boolean(version)
}

function pushIncompleteMarkerIssues(
  issues: RuntimeAssetValidationIssue[],
  libraryMarkers: DeckRuntimeLibraryMarkers,
  addonMarkers: DeckRuntimeAddonMarkers,
) {
  if (
    isIncompleteRuntimeMarkerPair(libraryMarkers.arkRuntimeLib, libraryMarkers.arkRuntimeVersion)
  ) {
    issues.push({
      code: 'runtime_version_mismatch',
      message:
        'Runtime library markers must include both data-ark-runtime-lib and data-ark-runtime-version.',
      severity: 'error',
    })
  }

  if (
    isIncompleteRuntimeMarkerPair(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )
  ) {
    issues.push({
      code: 'runtime_version_mismatch',
      message:
        'Addon runtime markers must include both data-ark-runtime-addon-lib and data-ark-runtime-addon-version.',
      severity: 'error',
    })
  }
}

function recordReferenceIssue(
  issues: RuntimeAssetValidationIssue[],
  referencedAssets: Map<string, Set<string>>,
  declaredRuntimes: ApprovedRuntimeEntry[],
  reference: string,
) {
  const ref = parseRuntimeAssetUrl(reference)

  if (!ref) {
    issues.push({
      code: 'unapproved_runtime_asset',
      message: `Unapproved runtime asset reference: ${reference}`,
      severity: 'error',
    })
    return
  }

  const lookup = lookupRuntimeAsset(ref)

  if (!lookup) {
    if (
      declaredRuntimes.some(
        (runtime) => runtime.id === ref.runtimeId && runtime.version !== ref.version,
      )
    ) {
      issues.push({
        code: 'runtime_version_mismatch',
        message: `Runtime asset ${reference} does not match a declared runtime version for ${ref.runtimeId}.`,
        severity: 'error',
      })
      return
    }

    issues.push({
      code: 'unapproved_runtime_asset',
      message: `Runtime asset is not in the approved registry: ${reference}`,
      severity: 'error',
    })
    return
  }

  const key = `${ref.runtimeId}@${ref.version}`
  const paths = referencedAssets.get(key) ?? new Set<string>()
  paths.add(ref.assetPath)
  referencedAssets.set(key, paths)

  if (
    declaredRuntimes.length > 0 &&
    !runtimeMatchesDeclaredVersion(ref.runtimeId, ref.version, declaredRuntimes)
  ) {
    issues.push({
      code: 'runtime_version_mismatch',
      message: `Runtime asset ${reference} does not match any declared runtime library version.`,
      severity: 'error',
    })
  }
}

function pushMissingRequiredAssets(
  issues: RuntimeAssetValidationIssue[],
  referencedAssets: Map<string, Set<string>>,
  declaredRuntimes: ApprovedRuntimeEntry[],
) {
  for (const runtime of declaredRuntimes) {
    const key = `${runtime.id}@${runtime.version}`
    const paths = referencedAssets.get(key) ?? new Set<string>()
    const required = [...(runtime.requiredAssets.css ?? []), ...(runtime.requiredAssets.js ?? [])]
    const missing = required.filter((assetPath) => !paths.has(assetPath))

    if (missing.length > 0) {
      issues.push({
        code: 'missing_runtime_assets',
        message: `Missing required runtime assets for ${runtime.id}@${runtime.version}: ${missing.join(', ')}.`,
        severity: 'error',
      })
    }
  }
}

function pushUndeclaredRuntimeIssues(
  issues: RuntimeAssetValidationIssue[],
  libraryMarkers: DeckRuntimeLibraryMarkers,
  addonMarkers: DeckRuntimeAddonMarkers,
) {
  if (libraryMarkers.arkRuntimeLib && libraryMarkers.arkRuntimeVersion) {
    const runtime = getApprovedRuntime(
      libraryMarkers.arkRuntimeLib,
      libraryMarkers.arkRuntimeVersion,
    )

    if (!runtime) {
      issues.push({
        code: 'unapproved_runtime_asset',
        message: `Declared runtime library ${libraryMarkers.arkRuntimeLib}@${libraryMarkers.arkRuntimeVersion} is not in the approved registry.`,
        severity: 'error',
      })
    }
  }

  if (addonMarkers.arkRuntimeAddonLib && addonMarkers.arkRuntimeAddonVersion) {
    const runtime = getApprovedRuntime(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )

    if (!runtime) {
      issues.push({
        code: 'unapproved_runtime_asset',
        message: `Declared addon runtime ${addonMarkers.arkRuntimeAddonLib}@${addonMarkers.arkRuntimeAddonVersion} is not in the approved registry.`,
        severity: 'error',
      })
    }
  }
}

export function validateRuntimeAssetReferences(
  references: string[],
  libraryMarkers: DeckRuntimeLibraryMarkers,
  addonMarkers: DeckRuntimeAddonMarkers = {
    arkRuntimeAddonLib: null,
    arkRuntimeAddonVersion: null,
  },
) {
  const issues: RuntimeAssetValidationIssue[] = []
  pushIncompleteMarkerIssues(issues, libraryMarkers, addonMarkers)

  const referencedAssets = new Map<string, Set<string>>()
  const declaredRuntimes = collectDeclaredDeckRuntimes(libraryMarkers, addonMarkers)

  for (const reference of references) {
    recordReferenceIssue(issues, referencedAssets, declaredRuntimes, reference)
  }

  pushMissingRequiredAssets(issues, referencedAssets, declaredRuntimes)
  pushUndeclaredRuntimeIssues(issues, libraryMarkers, addonMarkers)
  return issues
}
