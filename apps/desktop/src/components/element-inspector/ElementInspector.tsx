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

  const kind = getInspectorElementKind(selection)
  const disabledReason = getInspectorDisabledReason(selection)
  const busy = isSaving || textEditActive || !onApplyOperations
  const canModify = disabledReason === null && !busy
  const canModifyGeometry = canModify && selection.managed && selection.geometryEditable === true
  const canModifyLayer = canModify && selection.managed
  const textStyle = selection.textStyle ?? null
  const textAlign = textStyle ? normalizeTextAlign(textStyle.textAlign) : 'left'
  const resetAspectOperation = geometry ? buildResetImageAspectOperation(selection, geometry) : null

  return (
    <div className="flex max-h-[min(70vh,28rem)] w-60 flex-col overflow-y-auto rounded-lg bg-[var(--ark-titlebar)] shadow-md ring-1 ring-foreground/10">
      <InspectorHeader selection={selection} />
      <div className="flex flex-col gap-4 px-3 py-3">
        {disabledReason ? (
          <p
            className="rounded-sm border border-[var(--ark-warning)]/30 bg-[var(--ark-warning)]/10 px-2 py-1.5 text-[11px] leading-snug text-[var(--ark-warning)]"
            role="note"
          >
            {disabledReason}
          </p>
        ) : null}

        <IdentitySection kind={kind} selection={selection} />
        <GeometrySection
          canModifyGeometry={canModifyGeometry}
          geometry={geometry}
          onCommitField={actions.commitGeometryField}
        />
        <LayerSection
          canModifyLayer={canModifyLayer}
          onReorder={actions.commitReorder}
          zIndex={zIndex}
        />

        {showTextSection(selection) && textStyle ? (
          <TypographySection
            canModify={canModify}
            colorValue={actions.colorValue}
            onCommitColor={actions.commitColor}
            onCommitFontSize={actions.commitFontSize}
            onCommitLineHeight={actions.commitLineHeight}
            onCommitStyle={actions.commitStyle}
            textAlign={textAlign}
            textStyle={textStyle}
          />
        ) : null}

        {showImageSection(selection) ? (
          <ImageSection
            altText={selection.textPreview ?? ''}
            canModify={canModify}
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
          busy={busy}
          locked={selection.locked}
          onToggleLock={actions.commitLockToggle}
        />
      </div>
    </div>
  )
}
