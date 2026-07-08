import type { DeckVersionDiff, DeckVersionProvenance, DeckVersionSummary } from '@ark/contracts'

export type VersionHistoryChip = {
  key: string
  label: string
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Compact chips for a version list row — derived only from summary metadata
 * (no HTML fetch). Legacy versions with null provenance/diff still render
 * source-aware chips when possible.
 */
export function getVersionHistoryChips(version: DeckVersionSummary): VersionHistoryChip[] {
  const chips: VersionHistoryChip[] = []
  const { diff, provenance, modelName, source } = version

  if (source === 'rollback' && provenance?.restoredVersionNumber != null) {
    chips.push({
      key: 'restored',
      label: `Restored v${provenance.restoredVersionNumber}`,
    })
  }

  if (source === 'agent' && modelName) {
    chips.push({ key: 'model', label: modelName })
  }

  if (diff?.kind === 'structural') {
    const added = diff.addedSlides?.length ?? 0
    const deleted = diff.deletedSlides?.length ?? 0
    const changed = diff.changedSlides?.length ?? 0
    const moved = diff.movedSlides?.length ?? 0

    if (added > 0) {
      chips.push({ key: 'added', label: `+${pluralize(added, 'slide')}` })
    }
    if (deleted > 0) {
      chips.push({ key: 'deleted', label: `−${pluralize(deleted, 'slide')}` })
    }
    if (changed > 0) {
      chips.push({ key: 'changed', label: `${pluralize(changed, 'slide')} changed` })
    }
    if (moved > 0 && added === 0 && deleted === 0 && changed === 0) {
      chips.push({ key: 'moved', label: `${pluralize(moved, 'slide')} moved` })
    }
  } else if (diff?.kind === 'coarse') {
    chips.push({ key: 'coarse', label: 'Content updated' })
  }

  if (source === 'manual' && provenance?.operations?.length) {
    const primary = provenance.operations[0]
    if (primary === 'undo' || primary === 'redo') {
      chips.push({
        key: 'history-op',
        label: primary === 'undo' ? 'Undo' : 'Redo',
      })
    }
  }

  return chips
}

export type VersionHistoryDetailSection = {
  key: string
  label: string
  value: string
}

/**
 * Detail-pane fields for provenance + diff. Returns an empty list when the
 * version has no structured metadata (legacy rows).
 */
export function getVersionHistoryDetailSections(
  version: DeckVersionSummary,
): VersionHistoryDetailSection[] {
  const sections: VersionHistoryDetailSection[] = []
  const provenance = version.provenance ?? null
  const diff = version.diff ?? null

  if (provenance) {
    sections.push(...describeProvenance(provenance, version))
  }

  if (diff) {
    sections.push(...describeDiff(diff))
  }

  if (version.modelProvider || version.modelName) {
    const parts = [version.modelProvider, version.modelName].filter(Boolean)
    sections.push({
      key: 'model',
      label: 'Model',
      value: parts.join(' / '),
    })
  }

  return sections
}

function describeProvenance(
  provenance: DeckVersionProvenance,
  version: DeckVersionSummary,
): VersionHistoryDetailSection[] {
  const sections: VersionHistoryDetailSection[] = []

  if (provenance.operations?.length) {
    sections.push({
      key: 'operations',
      label: 'Operations',
      value: provenance.operations.join(', '),
    })
  }

  if (provenance.slideIndexes?.length) {
    sections.push({
      key: 'slides',
      label: 'Slides',
      value: provenance.slideIndexes.map((index) => index + 1).join(', '),
    })
  }

  if (provenance.elementIds?.length) {
    sections.push({
      key: 'elements',
      label: 'Elements',
      value: pluralize(provenance.elementIds.length, 'element'),
    })
  }

  if (provenance.jobId) {
    sections.push({
      key: 'job',
      label: 'Generation job',
      value: provenance.jobId,
    })
  }

  if (typeof provenance.stepCount === 'number') {
    sections.push({
      key: 'steps',
      label: 'Agent steps',
      value: String(provenance.stepCount),
    })
  }

  if (provenance.toolCalls?.length) {
    sections.push({
      key: 'tools',
      label: 'Tool calls',
      value: provenance.toolCalls
        .map((call) => {
          const prefix = call.error ? `${call.toolName} (error)` : call.toolName
          return `${prefix}: ${call.summary}`
        })
        .join('\n'),
    })
  }

  if (provenance.restoredVersionNumber != null || provenance.restoredVersionId) {
    sections.push({
      key: 'restored',
      label: 'Restored version',
      value:
        provenance.restoredVersionNumber != null
          ? `Version ${provenance.restoredVersionNumber}`
          : (provenance.restoredVersionId ?? ''),
    })
  }

  if (provenance.runtimeManifestHash && version.source !== 'manual') {
    sections.push({
      key: 'manifest',
      label: 'Runtime manifest',
      value: provenance.runtimeManifestHash.slice(0, 12) + '…',
    })
  }

  return sections
}

function describeDiff(diff: DeckVersionDiff): VersionHistoryDetailSection[] {
  const sections: VersionHistoryDetailSection[] = []

  if (diff.kind === 'coarse') {
    const before = diff.htmlBytesBefore
    const after = diff.htmlBytesAfter
    sections.push({
      key: 'diff-kind',
      label: 'Diff',
      value:
        typeof before === 'number' && typeof after === 'number'
          ? `Coarse (${before} → ${after} bytes)`
          : 'Coarse content change',
    })
    return sections
  }

  const added = diff.addedSlides?.length ?? 0
  const deleted = diff.deletedSlides?.length ?? 0
  const changed = diff.changedSlides?.length ?? 0
  const moved = diff.movedSlides?.length ?? 0

  if (added || deleted || changed || moved) {
    const parts: string[] = []
    if (added) parts.push(`+${added}`)
    if (deleted) parts.push(`−${deleted}`)
    if (changed) parts.push(`${changed} changed`)
    if (moved) parts.push(`${moved} moved`)
    sections.push({
      key: 'slide-diff',
      label: 'Slide changes',
      value: parts.join(', '),
    })
  }

  if (diff.titleChanged) {
    sections.push({
      key: 'title-changed',
      label: 'Title',
      value: 'Changed',
    })
  }

  if (diff.assetsAdded?.length) {
    sections.push({
      key: 'assets-added',
      label: 'Assets added',
      value: diff.assetsAdded.join('\n'),
    })
  }

  if (diff.assetsRemoved?.length) {
    sections.push({
      key: 'assets-removed',
      label: 'Assets removed',
      value: diff.assetsRemoved.join('\n'),
    })
  }

  return sections
}

/** Resolve a restored-version pointer to a list entry when present. */
export function findRestoredVersion(
  versions: DeckVersionSummary[],
  provenance: DeckVersionProvenance | null | undefined,
): DeckVersionSummary | null {
  if (!provenance) {
    return null
  }

  if (provenance.restoredVersionId) {
    return versions.find((version) => version.id === provenance.restoredVersionId) ?? null
  }

  if (provenance.restoredVersionNumber != null) {
    return (
      versions.find((version) => version.versionNumber === provenance.restoredVersionNumber) ?? null
    )
  }

  return null
}
