import { useId, type ReactNode } from 'react'
import { AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon } from 'lucide-react'

import { ButtonGroup } from '@/components/ui/button-group'
import { cn } from '@/lib/ui/utils'
import type { EditorSelectionTextStyle } from '@ark/editor-runtime'
import {
  FONT_WEIGHT_OPTIONS,
  formatLineHeightValue,
  formatPxValue,
  normalizeFontWeight,
  type InspectorTextAlign,
} from '@/lib/editor/element-inspector'

import {
  CommitNumberField,
  InspectorIconButton,
  InspectorSection,
  inspectorFieldClassName,
} from './InspectorField'

const TEXT_ALIGN_OPTIONS: Array<{
  value: InspectorTextAlign
  label: string
  icon: ReactNode
}> = [
  { value: 'left', label: 'Align left', icon: <AlignLeftIcon className="size-3.5" /> },
  { value: 'center', label: 'Align center', icon: <AlignCenterIcon className="size-3.5" /> },
  { value: 'right', label: 'Align right', icon: <AlignRightIcon className="size-3.5" /> },
  { value: 'justify', label: 'Justify', icon: <AlignJustifyIcon className="size-3.5" /> },
]

export function TypographySection({
  canModify,
  colorValue,
  onCommitColor,
  onCommitFontSize,
  onCommitLineHeight,
  onCommitStyle,
  textAlign,
  textStyle,
}: {
  canModify: boolean
  colorValue: string
  onCommitColor: (hex: string) => void
  onCommitFontSize: (raw: string) => void
  onCommitLineHeight: (raw: string) => void
  onCommitStyle: (style: Record<string, string>, summary: string) => void
  textAlign: InspectorTextAlign
  textStyle: EditorSelectionTextStyle
}) {
  const colorInputId = useId()
  const weightSelectId = useId()

  return (
    <InspectorSection title="Text">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <CommitNumberField
          disabled={!canModify}
          label="Aa"
          onCommit={onCommitFontSize}
          suffix="px"
          value={formatPxValue(textStyle.fontSize)}
        />
        <CommitNumberField
          disabled={!canModify}
          label="Lh"
          onCommit={onCommitLineHeight}
          suffix="px"
          value={formatLineHeightValue(textStyle.lineHeight)}
        />
      </div>
      <label
        className="flex items-center justify-between gap-2 text-[11px]"
        htmlFor={weightSelectId}
      >
        <span className="text-[var(--ark-titlebar-muted)]">Weight</span>
        <select
          aria-label="Font weight"
          className={cn(inspectorFieldClassName, 'w-28 flex-none')}
          disabled={!canModify}
          id={weightSelectId}
          onChange={(event) =>
            onCommitStyle({ 'font-weight': event.target.value }, 'Updated font weight')
          }
          value={normalizeFontWeight(textStyle.fontWeight)}
        >
          {FONT_WEIGHT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-[11px]" htmlFor={colorInputId}>
        <span className="text-[var(--ark-titlebar-muted)]">Color</span>
        <input
          aria-label="Text color"
          className="h-6 w-28 flex-none cursor-pointer rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canModify}
          id={colorInputId}
          onChange={(event) => onCommitColor(event.target.value)}
          type="color"
          value={colorValue}
        />
      </label>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[var(--ark-titlebar-muted)]">Align</span>
        <ButtonGroup aria-label="Text alignment">
          {TEXT_ALIGN_OPTIONS.map((option) => (
            <InspectorIconButton
              active={textAlign === option.value}
              disabled={!canModify}
              key={option.value}
              label={option.label}
              onClick={() =>
                onCommitStyle({ 'text-align': option.value }, 'Updated text alignment')
              }
            >
              {option.icon}
            </InspectorIconButton>
          ))}
        </ButtonGroup>
      </div>
    </InspectorSection>
  )
}
