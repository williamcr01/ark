import type { EditorSelectionInfo } from '@ark/editor-runtime'
import { getInspectorKindLabel, type InspectorElementKind } from '@/lib/editor/element-inspector'

import { InspectorRow, InspectorSection } from './InspectorField'

export function IdentitySection({
  kind,
  selection,
}: {
  kind: InspectorElementKind
  selection: EditorSelectionInfo
}) {
  return (
    <InspectorSection title="Identity">
      <InspectorRow label="Kind">{getInspectorKindLabel(kind)}</InspectorRow>
      <InspectorRow label="Tag">{`<${selection.tagName}>`}</InspectorRow>
      {selection.role ? <InspectorRow label="Role">{selection.role}</InspectorRow> : null}
      <InspectorRow label="Slide">{selection.slideIndex + 1}</InspectorRow>
    </InspectorSection>
  )
}
