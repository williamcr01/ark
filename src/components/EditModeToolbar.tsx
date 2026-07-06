import type { ReactNode } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  ImageIcon,
  MousePointer2Icon,
  Redo2Icon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
} from 'lucide-react'

import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { EditorTool } from '../../shared/deck-editor-bridge.ts'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type EditModeToolbarProps = {
  activeTool: EditorTool
  canEditText: boolean
  hasDeck: boolean
  hasSelection: boolean
  isGenerating: boolean
  isSaving: boolean
  selectionLocked: boolean
  selectionManaged: boolean
  textEditActive: boolean
  onDelete?: () => void
  onDuplicate?: () => void
  onBringForward?: () => void
  onSendBackward?: () => void
  onEditText?: () => void
  onToolChange: (tool: EditorTool) => void
}

type ToolbarButtonProps = {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick?: () => void
  toggle?: boolean
}

function ToolbarButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
  toggle = false,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={toggle ? active : undefined}
          className={cn(
            buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
            'size-7 shrink-0 rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
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

export function EditModeToolbar({
  activeTool,
  canEditText,
  hasDeck,
  hasSelection,
  isGenerating,
  isSaving,
  selectionLocked,
  selectionManaged,
  textEditActive,
  onDelete,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onEditText,
  onToolChange,
}: EditModeToolbarProps) {
  const toolbarDisabled = !hasDeck || isGenerating || isSaving
  const canModifySelection = hasSelection && !selectionLocked && !toolbarDisabled && !textEditActive
  const canModifyManagedSelection = canModifySelection && selectionManaged
  const canUseTools = hasDeck && !isGenerating && !isSaving

  return (
    <div
      aria-label="Edit mode toolbar"
      className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3"
      role="toolbar"
    >
      <ButtonGroup aria-label="Editor tools" className="shrink-0">
        <ToolbarButton
          active={activeTool === 'select'}
          disabled={!canUseTools || textEditActive}
          label="Select"
          onClick={() => onToolChange('select')}
          toggle
        >
          <MousePointer2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={activeTool === 'text'}
          disabled={!canUseTools || textEditActive}
          label="Text box"
          onClick={() => onToolChange('text')}
          toggle
        >
          <TypeIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={activeTool === 'insert'}
          disabled={!canUseTools || textEditActive}
          label="Image"
          onClick={() => onToolChange('insert')}
          toggle
        >
          <ImageIcon className="size-3.5" />
        </ToolbarButton>
      </ButtonGroup>

      {canEditText ? (
        <>
          <ButtonGroupSeparator
            className="h-5 bg-[var(--ark-titlebar-border)]"
            orientation="vertical"
          />
          <ToolbarButton
            disabled={textEditActive || isSaving}
            label="Edit selected text"
            onClick={onEditText}
          >
            <TypeIcon className="size-3.5" />
          </ToolbarButton>
        </>
      ) : null}

      <ButtonGroupSeparator
        className="h-5 bg-[var(--ark-titlebar-border)]"
        orientation="vertical"
      />

      <ButtonGroup aria-label="Selection actions" className="shrink-0">
        <ToolbarButton
          disabled={!canModifyManagedSelection}
          label={
            selectionLocked
              ? 'Delete selected element (locked)'
              : hasSelection
                ? selectionManaged
                  ? 'Delete selected element'
                  : 'Delete selected element (not managed)'
                : 'Delete selected element (no selection)'
          }
          onClick={onDelete}
        >
          <Trash2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!canModifyManagedSelection}
          label={
            hasSelection
              ? selectionManaged
                ? 'Duplicate selected element'
                : 'Duplicate selected element (not managed)'
              : 'Duplicate selected element (no selection)'
          }
          onClick={onDuplicate}
        >
          <CopyIcon className="size-3.5" />
        </ToolbarButton>
      </ButtonGroup>

      <ButtonGroupSeparator
        className="hidden h-5 bg-[var(--ark-titlebar-border)] sm:block"
        orientation="vertical"
      />

      <ButtonGroup aria-label="Layer order" className="hidden shrink-0 sm:flex">
        <ToolbarButton
          disabled={!canModifyManagedSelection}
          label={
            hasSelection
              ? selectionManaged
                ? 'Bring forward'
                : 'Bring forward (not managed)'
              : 'Bring forward (no selection)'
          }
          onClick={onBringForward}
        >
          <ArrowUpIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!canModifyManagedSelection}
          label={
            hasSelection
              ? selectionManaged
                ? 'Send backward'
                : 'Send backward (not managed)'
              : 'Send backward (no selection)'
          }
          onClick={onSendBackward}
        >
          <ArrowDownIcon className="size-3.5" />
        </ToolbarButton>
      </ButtonGroup>

      <ButtonGroupSeparator
        className="h-5 bg-[var(--ark-titlebar-border)]"
        orientation="vertical"
      />

      <ButtonGroup aria-label="History" className="shrink-0">
        <ToolbarButton disabled label="Undo (coming soon)">
          <Undo2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton disabled label="Redo (coming soon)">
          <Redo2Icon className="size-3.5" />
        </ToolbarButton>
      </ButtonGroup>

      <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-[var(--ark-titlebar-muted)]">
        {!hasDeck ? <span>No deck loaded</span> : null}
        {hasDeck && isGenerating ? <span>Editing paused during generation</span> : null}
        {selectionLocked ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
            Locked
          </span>
        ) : null}
        {textEditActive ? <span>Editing text — press Escape to cancel</span> : null}
        {isSaving ? <span>Saving edit…</span> : null}
      </div>
    </div>
  )
}

export type PreviewEditModeToggleProps = {
  active: boolean
  disabled?: boolean
  onChange: (active: boolean) => void
}

export function PreviewEditModeToggle({
  active,
  disabled = false,
  onChange,
}: PreviewEditModeToggleProps) {
  return (
    <div
      aria-label="Preview or edit mode"
      className="inline-flex items-center rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] p-0.5"
      role="group"
    >
      <button
        aria-label="Preview mode"
        aria-pressed={!active}
        className={cn(
          'inline-flex h-5 items-center rounded-sm px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
          !active
            ? 'bg-[var(--ark-titlebar)] text-[var(--ark-titlebar-fg)] shadow-sm'
            : 'text-[var(--ark-titlebar-muted)] hover:text-[var(--ark-titlebar-fg)]',
        )}
        disabled={disabled}
        onClick={() => onChange(false)}
        type="button"
      >
        Preview
      </button>
      <button
        aria-label="Edit mode"
        aria-pressed={active}
        className={cn(
          'inline-flex h-5 items-center rounded-sm px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
          active
            ? 'bg-[var(--ark-accent-soft)] text-[var(--ark-accent)] shadow-sm'
            : 'text-[var(--ark-titlebar-muted)] hover:text-[var(--ark-titlebar-fg)]',
        )}
        disabled={disabled}
        onClick={() => onChange(true)}
        type="button"
      >
        Edit
      </button>
    </div>
  )
}
