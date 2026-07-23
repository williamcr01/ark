import { useMemo, useState } from 'react'
import { RotateCcwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DeckVersionDetail, DeckVersionSource, DeckVersionSummary } from '@/lib/deck-api'
import {
  detectRuntimeMode,
  getPreviewHtml,
  getPreviewSandbox,
  PREVIEW_IFRAME_SECURITY_PROPS,
} from '@/lib/deck-preview'
import {
  findRestoredVersion,
  getVersionHistoryChips,
  getVersionHistoryDetailSections,
} from '@/lib/version-history-display'
import { cn } from '@/lib/utils'

const SOURCE_LABELS: Record<DeckVersionSource, string> = {
  manual: 'Manual edit',
  agent: 'AI generation',
  upload: 'Upload',
  repair: 'Repair',
  rollback: 'Rollback',
}
const EMPTY_VERSIONS: DeckVersionSummary[] = []

function formatVersionTimestamp(createdAt: string) {
  const date = new Date(createdAt)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  })
}

function RuntimeBadge({ manifest }: { manifest: DeckVersionSummary['runtimeManifest'] }) {
  if (!manifest) {
    return null
  }

  const label =
    manifest.runtimeMode === 'custom-js'
      ? 'Custom JS'
      : manifest.runtimeMode === 'reveal'
        ? manifest.usesRevealAdapter
          ? 'Reveal runtime'
          : 'Reveal (static preview)'
        : 'Static'

  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  )
}

function ValidationBadge({ status }: { status: DeckVersionSummary['validationStatus'] }) {
  const label =
    status === 'valid' ? 'Valid' : status === 'invalid' ? 'Invalid' : 'Unknown validation'

  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        status === 'valid' && 'bg-emerald-500/10 text-emerald-700',
        status === 'invalid' && 'bg-destructive/10 text-destructive',
        status === 'unknown' && 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

function ProvenanceChip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  )
}

export type VersionHistoryDialogProps = {
  activeVersionId: string | null
  deckTitle: string
  disabled?: boolean
  isLoadingVersions?: boolean
  onClearPreview: () => void
  onInspectVersion: (versionId: string) => Promise<DeckVersionDetail | null>
  onOpenChange: (open: boolean) => void
  onRefreshVersions: () => Promise<DeckVersionSummary[]>
  onRollback: (versionId: string) => Promise<void>
  open: boolean
  previewVersion: DeckVersionDetail | null
  versions: DeckVersionSummary[]
}

export function VersionHistoryDialog({
  activeVersionId,
  deckTitle,
  disabled = false,
  isLoadingVersions = false,
  onClearPreview,
  onInspectVersion,
  onOpenChange,
  onRefreshVersions,
  onRollback,
  open,
  previewVersion,
  versions = EMPTY_VERSIONS,
}: VersionHistoryDialogProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [inspectError, setInspectError] = useState('')
  const [isInspecting, setIsInspecting] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [rollbackError, setRollbackError] = useState('')

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedVersionId(null)
      setInspectError('')
      setRollbackError('')
      onClearPreview()
    } else {
      void onRefreshVersions()
    }

    onOpenChange(nextOpen)
  }

  const handleInspect = async (versionId: string) => {
    setSelectedVersionId(versionId)
    setInspectError('')
    setIsInspecting(true)

    try {
      await onInspectVersion(versionId)
    } catch (error) {
      setInspectError(error instanceof Error ? error.message : 'Could not load that version.')
    } finally {
      setIsInspecting(false)
    }
  }

  const handleRollback = async () => {
    if (!selectedVersionId || selectedVersionId === activeVersionId) {
      return
    }

    const selectedVersion = versions.find((version) => version.id === selectedVersionId)
    const confirmed = window.confirm(
      `Restore version ${selectedVersion?.versionNumber ?? ''}? This creates a new active version from that snapshot.`,
    )

    if (!confirmed) {
      return
    }

    setRollbackError('')
    setIsRollingBack(true)

    try {
      await onRollback(selectedVersionId)
      handleOpenChange(false)
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : 'Could not roll back the deck.')
    } finally {
      setIsRollingBack(false)
    }
  }

  const matchingPreview =
    previewVersion && previewVersion.id === selectedVersionId ? previewVersion : null
  const selectedVersion =
    matchingPreview ?? versions.find((version) => version.id === selectedVersionId) ?? null
  const previewSourceHtml = matchingPreview?.html ?? ''
  const previewManifest = selectedVersion?.runtimeManifest ?? null
  const runtimeMode = previewManifest?.runtimeMode ?? detectRuntimeMode(previewSourceHtml)
  const sanitizedPreviewHtml = useMemo(
    () =>
      previewSourceHtml
        ? getPreviewHtml(previewSourceHtml, { manifest: previewManifest ?? undefined })
        : '',
    [previewManifest, previewSourceHtml],
  )
  const selectedDetailSections = useMemo(
    () => (selectedVersion ? getVersionHistoryDetailSections(selectedVersion) : []),
    [selectedVersion],
  )
  const restoredTarget = useMemo(
    () => (selectedVersion ? findRestoredVersion(versions, selectedVersion.provenance) : null),
    [selectedVersion, versions],
  )

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            {deckTitle
              ? `Browse and restore prior versions of “${deckTitle}”.`
              : 'Browse prior deck versions.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[24rem] grid-cols-1 gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="border-b md:border-b-0 md:border-r">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">Saved versions</span>
              {isLoadingVersions ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : (
                <span className="text-xs text-muted-foreground">{versions.length} total</span>
              )}
            </div>

            <div className="max-h-[22rem] overflow-y-auto p-2">
              {versions.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {versions.map((version) => {
                    const isSelected = selectedVersionId === version.id
                    const chips = getVersionHistoryChips(version)

                    return (
                      <li key={version.id}>
                        <button
                          className={cn(
                            'flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-transparent hover:bg-muted/60',
                          )}
                          disabled={disabled || isRollingBack}
                          onClick={() => {
                            void handleInspect(version.id)
                          }}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              Version {version.versionNumber}
                            </span>
                            {version.isActive ? (
                              <span className="text-[11px] font-medium text-primary">Active</span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatVersionTimestamp(version.createdAt)}</span>
                            <span aria-hidden>·</span>
                            <span>{SOURCE_LABELS[version.source]}</span>
                          </div>
                          {version.summary ? (
                            <span className="text-xs text-muted-foreground">{version.summary}</span>
                          ) : null}
                          {chips.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              {chips.map((chip) => (
                                <ProvenanceChip key={chip.key} label={chip.label} />
                              ))}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <ValidationBadge status={version.validationStatus} />
                            <RuntimeBadge manifest={version.runtimeManifest} />
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="px-3 py-6 text-sm text-muted-foreground">
                  {isLoadingVersions ? 'Loading version history…' : 'No saved versions yet.'}
                </p>
              )}
            </div>
          </div>

          <div className="flex min-h-[16rem] flex-col">
            <div className="border-b px-4 py-3">
              <span className="text-sm font-medium">Version preview</span>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-4">
              {selectedVersion ? (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Version {selectedVersion.versionNumber}
                      {selectedVersion.isActive ? ' (active)' : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatVersionTimestamp(selectedVersion.createdAt)} ·{' '}
                      {SOURCE_LABELS[selectedVersion.source]}
                    </p>
                    {selectedVersion.summary ? (
                      <p className="text-sm text-muted-foreground">{selectedVersion.summary}</p>
                    ) : null}
                  </div>

                  {selectedDetailSections.length > 0 ? (
                    <dl className="space-y-2 rounded-md border bg-muted/20 px-3 py-2">
                      {selectedDetailSections.map((section) => (
                        <div key={section.key} className="space-y-0.5">
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {section.label}
                          </dt>
                          <dd className="whitespace-pre-wrap text-xs text-foreground">
                            {section.key === 'restored' && restoredTarget ? (
                              <button
                                className="text-primary underline-offset-2 hover:underline"
                                disabled={disabled || isRollingBack || isInspecting}
                                onClick={() => {
                                  void handleInspect(restoredTarget.id)
                                }}
                                type="button"
                              >
                                {section.value}
                              </button>
                            ) : (
                              section.value
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {sanitizedPreviewHtml ? (
                    <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/20">
                      <iframe
                        className="h-56 w-full bg-white"
                        referrerPolicy="no-referrer"
                        sandbox={getPreviewSandbox(runtimeMode)}
                        srcDoc={sanitizedPreviewHtml}
                        title={`Version ${selectedVersion.versionNumber} preview`}
                        {...PREVIEW_IFRAME_SECURITY_PROPS}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {isInspecting ? 'Loading preview…' : 'Select a version to preview its HTML.'}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a version to inspect its metadata and preview.
                </p>
              )}

              {inspectError ? (
                <p className="text-xs text-destructive" role="alert">
                  {inspectError}
                </p>
              ) : null}
              {rollbackError ? (
                <p className="text-xs text-destructive" role="alert">
                  {rollbackError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button onClick={() => handleOpenChange(false)} type="button" variant="outline">
            Close
          </Button>
          <Button
            disabled={
              disabled ||
              !selectedVersionId ||
              selectedVersionId === activeVersionId ||
              isInspecting ||
              isRollingBack
            }
            onClick={() => {
              void handleRollback()
            }}
            type="button"
          >
            <RotateCcwIcon />
            Restore selected version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
