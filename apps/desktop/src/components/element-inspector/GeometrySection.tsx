import type { EditorNormalizedRect } from '@ark/editor-runtime'
import { formatPercentValue, type InspectorGeometryField } from '@/lib/editor/element-inspector'

import { CommitNumberField, InspectorSection } from './InspectorField'

const GEOMETRY_FIELDS: Array<{ field: InspectorGeometryField; label: string; summary: string }> = [
  { field: 'x', label: 'X', summary: 'Moved element' },
  { field: 'y', label: 'Y', summary: 'Moved element' },
  { field: 'width', label: 'W', summary: 'Resized element' },
  { field: 'height', label: 'H', summary: 'Resized element' },
]

export function GeometrySection({
  canModifyGeometry,
  geometry,
  onCommitField,
}: {
  canModifyGeometry: boolean
  geometry: EditorNormalizedRect | null
  onCommitField: (field: InspectorGeometryField, raw: string, summary: string) => void
}) {
  return (
    <InspectorSection title="Geometry">
      {geometry ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {GEOMETRY_FIELDS.map(({ field, label, summary }) => (
            <CommitNumberField
              disabled={!canModifyGeometry}
              key={field}
              label={label}
              onCommit={(raw) => onCommitField(field, raw, summary)}
              suffix="%"
              value={formatPercentValue(geometry[field])}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--ark-titlebar-muted)]">
          Geometry unavailable for this selection.
        </p>
      )}
    </InspectorSection>
  )
}
