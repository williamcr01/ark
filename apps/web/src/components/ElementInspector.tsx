import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  LockIcon,
  LockOpenIcon,
  ScanIcon,
} from 'lucide-react'

import { ButtonGroup } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  EditorNormalizedRect,
  EditorSelectionInfo,
} from '@ark/deck-core/deck-editor-bridge.ts'
import type { DeckElementPatchOperation } from '@ark/deck-core/deck-patch.ts'
import type { ImageFitMode } from '@ark/deck-core/deck-image.ts'
import {
  buildAttrsOperation,
  buildGeometryFieldOperation,
  buildInlineStyleOperation,
  buildInspectorTarget,
  buildResetImageAspectOperation,
  cssColorToHex,
  formatPercentValue,
  FONT_WEIGHT_OPTIONS,
  getInspectorDisabledReason,
  getInspectorElementKind,
  getInspectorKindLabel,
  normalizeFontWeight,
  normalizeTextAlign,
  parsePercentInput,
  showImageSection,
  showTextSection,
  type InspectorGeometryField,
  type InspectorTextAlign,
} from '@/lib/element-inspector'

const COLOR_COMMIT_DEBOUNCE_MS = 400

export type ElementInspectorProps = {
  selection: EditorSelectionInfo | null
  geometry: EditorNormalizedRect | null
  zIndex: number | null
  isSaving: boolean
  textEditActive: boolean
  /** Floating panel (default) vs legacy full-height sidebar chrome. */
  variant?: 'floating' | 'sidebar'
  onApplyOperations?: (operations: DeckElementPatchOperation[], summary: string) => void
}

const fieldClassName =
  'h-6 w-full min-w-0 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-1.5 text-[11px] text-[var(--ark-titlebar-fg)] outline-none focus:border-[var(--ark-accent)] disabled:cursor-not-allowed disabled:opacity-50'

const sectionTitleClassName =
  'text-[10px] font-semibold uppercase tracking-wide text-[var(--ark-titlebar-muted)]'

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className={sectionTitleClassName}>{title}</h3>
      {children}
    </section>
  )
}

function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-[var(--ark-titlebar-muted)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--ark-titlebar-fg)]">{children}</span>
    </div>
  )
}

type CommitNumberFieldProps = {
  label: string
  value: string
  disabled: boolean
  suffix: string
  onCommit: (raw: string) => void
}

/** Numeric input that commits on blur or Enter instead of every keystroke. */
function CommitNumberField({ label, value, disabled, suffix, onCommit }: CommitNumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  // Mirrors the draft state so Enter → commit → blur cannot double-commit
  // before React flushes the state reset.
  const draftRef = useRef<string | null>(null)

  const setDraftValue = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const commit = () => {
    const current = draftRef.current

    if (current !== null && current !== value) {
      onCommit(current)
    }

    setDraftValue(null)
  }

  return (
    <label className="flex min-w-0 items-center gap-1 text-[11px]" htmlFor={id}>
      <span className="w-3.5 shrink-0 text-[var(--ark-titlebar-muted)]">{label}</span>
      <span className="relative flex min-w-0 flex-1 items-center">
        <input
          aria-label={`${label} (${suffix})`}
          className={cn(fieldClassName, 'pr-6 text-right tabular-nums')}
          disabled={disabled}
          id={id}
          inputMode="decimal"
          onBlur={commit}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraftValue(null)
              event.currentTarget.blur()
            }
          }}
          type="text"
          value={draft ?? value}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 text-[10px] text-[var(--ark-titlebar-muted)]"
        >
          {suffix}
        </span>
      </span>
    </label>
  )
}

type CommitTextFieldProps = {
  label: string
  value: string
  disabled: boolean
  placeholder?: string
  onCommit: (next: string) => void
}

/** Text input that commits on blur or Enter instead of every keystroke. */
function CommitTextField({ label, value, disabled, placeholder, onCommit }: CommitTextFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)

  const setDraftValue = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const commit = () => {
    const current = draftRef.current

    if (current !== null && current !== value) {
      onCommit(current)
    }

    setDraftValue(null)
  }

  return (
    <label className="flex flex-col gap-1 text-[11px]" htmlFor={id}>
      <span className="text-[var(--ark-titlebar-muted)]">{label}</span>
      <input
        className={fieldClassName}
        disabled={disabled}
        id={id}
        onBlur={commit}
        onChange={(event) => setDraftValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraftValue(null)
            event.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        type="text"
        value={draft ?? value}
      />
    </label>
  )
}

type InspectorIconButtonProps = {
  active?: boolean
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
}

function InspectorIconButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: InspectorIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={active}
          className={cn(
            buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
            'size-6 shrink-0 rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
            'hover:bg-[var(--ark-titlebar-hover)]',
            'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
            active && 'bg-[var(--ark-titlebar-active)] text-[var(--ark-accent)]',
          )}
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          <span aria-hidden className="inline-flex">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

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

const GEOMETRY_FIELDS: Array<{ field: InspectorGeometryField; label: string; summary: string }> = [
  { field: 'x', label: 'X', summary: 'Moved element' },
  { field: 'y', label: 'Y', summary: 'Moved element' },
  { field: 'width', label: 'W', summary: 'Resized element' },
  { field: 'height', label: 'H', summary: 'Resized element' },
]

export function ElementInspector({
  selection,
  geometry,
  zIndex,
  isSaving,
  textEditActive,
  variant = 'floating',
  onApplyOperations,
}: ElementInspectorProps) {
  const colorInputId = useId()
  const weightSelectId = useId()
  const fitSelectId = useId()
  const colorCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The color draft is keyed to the element it was edited on so a selection
  // change discards it without needing a state reset in an effect.
  const [colorDraftState, setColorDraftState] = useState<{
    elementId: string
    value: string
  } | null>(null)

  const selectionElementId = selection?.elementId ?? null
  const colorDraft =
    colorDraftState && colorDraftState.elementId === selectionElementId
      ? colorDraftState.value
      : null

  // Cancel any pending debounced color commit when the selection changes or
  // the inspector unmounts.
  useEffect(() => {
    return () => {
      if (colorCommitTimerRef.current !== null) {
        clearTimeout(colorCommitTimerRef.current)
        colorCommitTimerRef.current = null
      }
    }
  }, [selectionElementId])

  if (!selection) {
    if (variant === 'floating') {
      return null
    }

    return (
      <aside
        aria-label="Element inspector"
        className="flex w-60 shrink-0 flex-col border-l border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)]"
      >
        <div className="flex h-9 shrink-0 items-center border-b border-[var(--ark-titlebar-border)] px-3">
          <h2 className="text-[11px] font-semibold text-[var(--ark-titlebar-fg)]">Inspector</h2>
        </div>
        <p className="px-3 py-4 text-[11px] leading-relaxed text-[var(--ark-titlebar-muted)]">
          Select an element on the slide to inspect and edit its properties.
        </p>
      </aside>
    )
  }

  const kind = getInspectorElementKind(selection)
  const disabledReason = getInspectorDisabledReason(selection)
  const busy = isSaving || textEditActive || !onApplyOperations
  const canModify = disabledReason === null && !busy
  const canModifyGeometry = canModify && selection.managed && selection.geometryEditable === true
  const canModifyLayer = canModify && selection.managed
  const textStyle = selection.textStyle ?? null
  const textAlign = textStyle ? normalizeTextAlign(textStyle.textAlign) : 'left'
  const colorValue =
    colorDraft ?? (textStyle ? (cssColorToHex(textStyle.color) ?? '#000000') : '#000000')

  const apply = (operations: DeckElementPatchOperation[], summary: string) => {
    if (operations.length === 0) {
      return
    }

    onApplyOperations?.(operations, summary)
  }

  const commitGeometryField = (field: InspectorGeometryField, raw: string, summary: string) => {
    if (!geometry) {
      return
    }

    const normalized = parsePercentInput(raw)

    if (normalized === null) {
      return
    }

    const operation = buildGeometryFieldOperation(selection, geometry, field, normalized)

    if (operation) {
      apply([operation], summary)
    }
  }

  const commitStyle = (style: Record<string, string>, summary: string) => {
    apply([buildInlineStyleOperation(selection, style)], summary)
  }

  const commitColor = (hex: string) => {
    setColorDraftState({ elementId: selection.elementId, value: hex })

    if (colorCommitTimerRef.current !== null) {
      clearTimeout(colorCommitTimerRef.current)
    }

    colorCommitTimerRef.current = setTimeout(() => {
      colorCommitTimerRef.current = null
      commitStyle({ color: hex }, 'Updated text color')
    }, COLOR_COMMIT_DEBOUNCE_MS)
  }

  const commitFontSize = (raw: string) => {
    const parsed = Number.parseFloat(raw)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return
    }

    const clamped = Math.max(4, Math.min(400, Math.round(parsed * 10) / 10))
    commitStyle({ 'font-size': `${clamped}px` }, 'Updated font size')
  }

  const commitLineHeight = (raw: string) => {
    const parsed = Number.parseFloat(raw)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return
    }

    const clamped = Math.max(4, Math.min(600, Math.round(parsed * 10) / 10))
    commitStyle({ 'line-height': `${clamped}px` }, 'Updated line height')
  }

  const commitImageFit = (fit: ImageFitMode) => {
    apply(
      [
        buildInlineStyleOperation(selection, { 'object-fit': fit }),
        buildAttrsOperation(selection, { 'data-ark-fit': fit }),
      ],
      'Updated image fit mode',
    )
  }

  const commitReorder = (direction: 'front' | 'back') => {
    apply(
      [
        {
          op: 'reorder_element',
          ...buildInspectorTarget(selection),
          direction,
        },
      ],
      direction === 'front' ? 'Brought element forward' : 'Sent element backward',
    )
  }

  const commitLockToggle = () => {
    apply(
      [
        {
          op: selection.locked ? 'unlock_element' : 'lock_element',
          ...buildInspectorTarget(selection),
        },
      ],
      selection.locked ? 'Unlocked element' : 'Locked element',
    )
  }

  const resetAspectOperation = geometry ? buildResetImageAspectOperation(selection, geometry) : null

  const shellClassName =
    variant === 'floating'
      ? 'flex max-h-[min(70vh,28rem)] w-60 flex-col overflow-y-auto rounded-lg bg-[var(--ark-titlebar)] shadow-md ring-1 ring-foreground/10'
      : 'flex w-60 shrink-0 flex-col overflow-y-auto border-l border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)]'

  return (
    <div
      aria-label={variant === 'floating' ? undefined : 'Element inspector'}
      className={shellClassName}
      role={variant === 'floating' ? undefined : 'complementary'}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ark-titlebar-border)] px-3">
        <h2 className="text-[11px] font-semibold text-[var(--ark-titlebar-fg)]">Inspector</h2>
        <span className="flex items-center gap-1">
          {selection.managed ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              Managed
            </span>
          ) : null}
          {selection.locked ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
              Locked
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-3 py-3">
        {disabledReason ? (
          <p
            className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300"
            role="note"
          >
            {disabledReason}
          </p>
        ) : null}

        <InspectorSection title="Identity">
          <InspectorRow label="Kind">{getInspectorKindLabel(kind)}</InspectorRow>
          <InspectorRow label="Tag">{`<${selection.tagName}>`}</InspectorRow>
          {selection.role ? <InspectorRow label="Role">{selection.role}</InspectorRow> : null}
          <InspectorRow label="Slide">{selection.slideIndex + 1}</InspectorRow>
        </InspectorSection>

        <InspectorSection title="Geometry">
          {geometry ? (
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {GEOMETRY_FIELDS.map(({ field, label, summary }) => (
                <CommitNumberField
                  disabled={!canModifyGeometry}
                  key={field}
                  label={label}
                  onCommit={(raw) => commitGeometryField(field, raw, summary)}
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

        <InspectorSection title="Layer">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--ark-titlebar-muted)]">
              Z-index <span className="text-[var(--ark-titlebar-fg)]">{zIndex ?? 'auto'}</span>
            </span>
            <ButtonGroup aria-label="Layer order">
              <InspectorIconButton
                disabled={!canModifyLayer}
                label="Bring forward"
                onClick={() => commitReorder('front')}
              >
                <ArrowUpIcon className="size-3.5" />
              </InspectorIconButton>
              <InspectorIconButton
                disabled={!canModifyLayer}
                label="Send backward"
                onClick={() => commitReorder('back')}
              >
                <ArrowDownIcon className="size-3.5" />
              </InspectorIconButton>
            </ButtonGroup>
          </div>
        </InspectorSection>

        {showTextSection(selection) && textStyle ? (
          <InspectorSection title="Text">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              <CommitNumberField
                disabled={!canModify}
                label="Aa"
                onCommit={commitFontSize}
                suffix="px"
                value={String(Math.round(textStyle.fontSize * 10) / 10)}
              />
              <CommitNumberField
                disabled={!canModify}
                label="Lh"
                onCommit={commitLineHeight}
                suffix="px"
                value={
                  textStyle.lineHeight === null
                    ? ''
                    : String(Math.round(textStyle.lineHeight * 10) / 10)
                }
              />
            </div>
            <label
              className="flex items-center justify-between gap-2 text-[11px]"
              htmlFor={weightSelectId}
            >
              <span className="text-[var(--ark-titlebar-muted)]">Weight</span>
              <select
                aria-label="Font weight"
                className={cn(fieldClassName, 'w-28 flex-none')}
                disabled={!canModify}
                id={weightSelectId}
                onChange={(event) =>
                  commitStyle({ 'font-weight': event.target.value }, 'Updated font weight')
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
            <label
              className="flex items-center justify-between gap-2 text-[11px]"
              htmlFor={colorInputId}
            >
              <span className="text-[var(--ark-titlebar-muted)]">Color</span>
              <input
                aria-label="Text color"
                className="h-6 w-28 flex-none cursor-pointer rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canModify}
                id={colorInputId}
                onChange={(event) => commitColor(event.target.value)}
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
                      commitStyle({ 'text-align': option.value }, 'Updated text alignment')
                    }
                  >
                    {option.icon}
                  </InspectorIconButton>
                ))}
              </ButtonGroup>
            </div>
          </InspectorSection>
        ) : null}

        {showImageSection(selection) ? (
          <InspectorSection title="Image">
            <CommitTextField
              disabled={!canModify}
              label="Alt text"
              onCommit={(alt) =>
                apply([buildAttrsOperation(selection, { alt })], 'Updated image alt text')
              }
              placeholder="Describe image"
              value={selection.textPreview ?? ''}
            />
            <label
              className="flex items-center justify-between gap-2 text-[11px]"
              htmlFor={fitSelectId}
            >
              <span className="text-[var(--ark-titlebar-muted)]">Fit</span>
              <select
                aria-label="Image fit mode"
                className={cn(fieldClassName, 'w-28 flex-none')}
                disabled={!canModify}
                id={fitSelectId}
                onChange={(event) => commitImageFit(event.target.value as ImageFitMode)}
                value={selection.imageFit ?? 'contain'}
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="fill">Fill</option>
              </select>
            </label>
            <InspectorRow label="Intrinsic">
              {selection.imageNaturalSize
                ? `${selection.imageNaturalSize.width} × ${selection.imageNaturalSize.height} px`
                : 'Unknown'}
            </InspectorRow>
            <button
              aria-label="Reset to image aspect ratio"
              className={cn(
                buttonVariants({ size: 'sm', variant: 'ghost' }),
                'h-6 justify-start gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] px-2 text-[11px] text-[var(--ark-titlebar-fg)] shadow-none',
                'hover:bg-[var(--ark-titlebar-hover)]',
                'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
              )}
              disabled={!canModify || resetAspectOperation === null}
              onClick={() => {
                if (resetAspectOperation) {
                  apply([resetAspectOperation], 'Reset image to intrinsic aspect ratio')
                }
              }}
              type="button"
            >
              <ScanIcon aria-hidden className="size-3.5" />
              Reset aspect ratio
            </button>
          </InspectorSection>
        ) : null}

        <InspectorSection title="State">
          <button
            aria-label={selection.locked ? 'Unlock element' : 'Lock element'}
            className={cn(
              buttonVariants({ size: 'sm', variant: 'ghost' }),
              'h-6 justify-start gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] px-2 text-[11px] text-[var(--ark-titlebar-fg)] shadow-none',
              'hover:bg-[var(--ark-titlebar-hover)]',
              'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
            )}
            disabled={busy}
            onClick={commitLockToggle}
            type="button"
          >
            {selection.locked ? (
              <>
                <LockOpenIcon aria-hidden className="size-3.5" />
                Unlock element
              </>
            ) : (
              <>
                <LockIcon aria-hidden className="size-3.5" />
                Lock element
              </>
            )}
          </button>
        </InspectorSection>
      </div>
    </div>
  )
}
