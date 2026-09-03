import type { EditorSelectionInfo } from '@ark/editor-runtime'

export function InspectorHeader({ selection }: { selection: EditorSelectionInfo }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ark-titlebar-border)] px-3">
      <h2 className="text-[11px] font-semibold text-[var(--ark-titlebar-fg)]">Inspector</h2>
      <span className="flex items-center gap-1">
        {selection.managed ? (
          <span className="rounded-full border border-[var(--ark-success)]/30 bg-[var(--ark-success)]/10 px-1.5 py-0.5 text-[10px] text-[var(--ark-success)]">
            Managed
          </span>
        ) : null}
        {selection.locked ? (
          <span className="rounded-full border border-[var(--ark-warning)]/30 bg-[var(--ark-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--ark-warning)]">
            Locked
          </span>
        ) : null}
      </span>
    </div>
  )
}
