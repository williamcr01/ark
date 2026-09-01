import type { DocumentHistorySource, DocumentHistorySummary } from '@ark/contracts'

const SOURCE_LABELS: Record<DocumentHistorySource, string> = {
  editor: 'Editor',
  agent: 'Agent',
  mcp: 'MCP',
  import: 'Import',
  create: 'Created',
  restore: 'Restore',
}

export function formatHistoryByteSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`
}

export function formatHistoryTimestamp(createdAt: string) {
  const parsed = Date.parse(createdAt)
  if (Number.isNaN(parsed)) return createdAt
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function historySourceLabel(source: DocumentHistorySource) {
  return SOURCE_LABELS[source]
}

export type DocumentHistoryRestoreListProps = {
  history: DocumentHistorySummary[]
  restoringRevision?: number | null
  onRestore: (revision: number) => void
}

export function DocumentHistoryRestoreList({
  history,
  restoringRevision = null,
  onRestore,
}: DocumentHistoryRestoreListProps) {
  if (history.length === 0) {
    return <p className="px-2 py-3 text-xs text-muted-foreground">No saved versions yet.</p>
  }

  const newestFirst = [...history].reverse()

  return (
    <ul aria-label="Document versions" className="flex flex-col gap-0.5 p-1">
      {newestFirst.map((entry) => {
        const restoring = restoringRevision === entry.revision
        return (
          <li key={entry.revision}>
            <button
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
              disabled={restoringRevision !== null}
              onClick={() => onRestore(entry.revision)}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span>Revision {entry.revision}</span>
                <span className="text-xs text-muted-foreground">
                  {historySourceLabel(entry.source)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{formatHistoryTimestamp(entry.createdAt)}</span>
                <span>{formatHistoryByteSize(entry.byteSize)}</span>
              </span>
              {restoring ? <span className="text-xs">Restoring…</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
