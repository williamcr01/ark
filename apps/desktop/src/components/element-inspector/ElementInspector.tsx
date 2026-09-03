import type { EditorNormalizedRect, EditorSelectionInfo } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import {
  buildResetImageAspectOperation,
  getInspectorDisabledReason,
  getInspectorElementKind,
  normalizeTextAlign,
  showImageSection,
  showTextSection,
} from '@/lib/editor/element-inspector'

import { GeometrySection } from './GeometrySection'
import { IdentitySection } from './IdentitySection'
import { ImageSection } from './ImageSection'
import { InspectorHeader } from './InspectorHeader'
import { LayerSection } from './LayerSection'
import { LockSection } from './LockSection'
import { TypographySection } from './TypographySection'
import { useInspectorActions } from './useInspectorActions'

export type ElementInspectorProps = {
  selection: EditorSelectionInfo | null
  geometry: EditorNormalizedRect | null
  zIndex: number | null
  isSaving: boolean
  textEditActive: boolean
  onApplyOperations?: (operations: DeckElementPatchOperation[], summary: string) => void
}

function inspectorView(selection: EditorSelectionInfo, isSaving: boolean, textEditActive: boolean) {
  const kind = getInspectorElementKind(selection)
  const disabledReason = getInspectorDisabledReason(selection)
  const busy = isSaving || textEditActive
  const canModify = disabledReason === null && !busy
  return {
    busy,
    canModify,
    canModifyGeometry: canModify && selection.managed && selection.geometryEditable === true,
    canModifyLayer: canModify && selection.managed,
    disabledReason,
    kind,
    textAlign: selection.textStyle ? normalizeTextAlign(selection.textStyle.textAlign) : 'left',
    textStyle: selection.textStyle ?? null,
  }
}

export function ElementInspector({
  selection,
  geometry,
  zIndex,
  isSaving,
  textEditActive,
  onApplyOperations,
}: ElementInspectorProps) {
  const actions = useInspectorActions({ geometry, onApplyOperations, selection })

  if (!selection) {
    return null
  }

  const view = inspectorView(selection, isSaving, !onApplyOperations || textEditActive)
  const resetAspectOperation = geometry ? buildResetImageAspectOperation(selection, geometry) : null

  return (
    <div className="flex max-h-[min(70vh,28rem)] w-60 flex-col overflow-y-auto rounded-lg bg-[var(--ark-titlebar)] shadow-md ring-1 ring-foreground/10">
      <InspectorHeader selection={selection} />
      <div className="flex flex-col gap-4 px-3 py-3">
        {view.disabledReason ? (
          <p
            className="rounded-sm border border-[var(--ark-warning)]/30 bg-[var(--ark-warning)]/10 px-2 py-1.5 text-[11px] leading-snug text-[var(--ark-warning)]"
            role="note"
          >
            {view.disabledReason}
          </p>
        ) : null}

        <IdentitySection kind={view.kind} selection={selection} />
        <GeometrySection
          canModifyGeometry={view.canModifyGeometry}
          geometry={geometry}
          onCommitField={actions.commitGeometryField}
        />
        <LayerSection
          canModifyLayer={view.canModifyLayer}
          onReorder={actions.commitReorder}
          zIndex={zIndex}
        />

        {showTextSection(selection) && view.textStyle ? (
          <TypographySection
            canModify={view.canModify}
            colorValue={actions.colorValue}
            onCommitColor={actions.commitColor}
            onCommitFontSize={actions.commitFontSize}
            onCommitLineHeight={actions.commitLineHeight}
            onCommitStyle={actions.commitStyle}
            textAlign={view.textAlign}
            textStyle={view.textStyle}
          />
        ) : null}

        {showImageSection(selection) ? (
          <ImageSection
            altText={selection.textPreview ?? ''}
            canModify={view.canModify}
            imageFit={selection.imageFit ?? 'contain'}
            naturalSize={selection.imageNaturalSize ?? null}
            onCommitAlt={actions.commitAlt}
            onCommitImageFit={actions.commitImageFit}
            onResetAspect={() => {
              if (resetAspectOperation) {
                onApplyOperations?.([resetAspectOperation], 'Reset image to intrinsic aspect ratio')
              }
            }}
            resetEnabled={resetAspectOperation !== null}
          />
        ) : null}

        <LockSection
          busy={view.busy}
          locked={selection.locked}
          onToggleLock={actions.commitLockToggle}
        />
      </div>
    </div>
  )
}
