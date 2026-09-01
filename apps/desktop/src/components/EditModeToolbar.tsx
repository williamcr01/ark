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
import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { EditorTool } from '@ark/editor-runtime'
import type { ImageFitMode } from '@ark/deck/document/image.ts'
import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'

export type EditModeToolbarProps = {
  activeTool: EditorTool
  /** Orthogonal editor capability flags (grouped to keep the props surface small). */
  state: {
    canEditText: boolean
    canRedo: boolean
    canUndo: boolean
    hasDeck: boolean
    hasSelection: boolean
    isGenerating: boolean
    isSaving: boolean
    selectedImage: boolean
    selectionLocked: boolean
    selectionManaged: boolean
    selectionUnsafe?: boolean
    textEditActive: boolean
  }
  imageAlt?: string
  imageFit?: ImageFitMode
  onBringForward?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onEditText?: () => void
  onImageAltChange?: (alt: string) => void
  onImageFitChange?: (fit: ImageFitMode) => void
  onPickImage?: () => void
  onRedo?: () => void
  onSendBackward?: () => void
  onToolChange: (tool: EditorTool) => void
  onUndo?: () => void
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
  state,
  imageAlt = '',
  imageFit = 'contain',
  onBringForward,
  onDelete,
  onDuplicate,
  onEditText,
  onImageAltChange,
  onImageFitChange,
  onPickImage,
  onRedo,
  onSendBackward,
  onToolChange,
  onUndo,
}: EditModeToolbarProps) {
  const {
    canEditText,
    canRedo,
    canUndo,
    hasDeck,
    hasSelection,
    isGenerating,
    isSaving,
    selectedImage,
    selectionLocked,
    selectionManaged,
    selectionUnsafe = false,
    textEditActive,
  } = state
  const toolbarDisabled = !hasDeck || isGenerating || isSaving
  const canModifySelection =
    hasSelection && !selectionLocked && !selectionUnsafe && !toolbarDisabled && !textEditActive
  const canReorderSelection = canModifySelection && selectionManaged
  const canUseTools = hasDeck && !isGenerating && !isSaving
  const undoDisabled = !canUndo || toolbarDisabled || textEditActive
  const redoDisabled = !canRedo || toolbarDisabled || textEditActive

  return (
    <div
      aria-label="Edit mode toolbar"
      className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3"
      role="toolbar"
    >
      <ToggleGroup
        aria-label="Editor tools"
        onValueChange={(value) => {
          if (!value) return
          const tool = value as EditorTool
          onToolChange(tool)
        }}
        type="single"
        value={activeTool}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ToggleGroupItem
                aria-label="Select"
                aria-pressed={activeTool === 'select'}
                disabled={!canUseTools || textEditActive}
                role="button"
                value="select"
              >
                <MousePointer2Icon className="size-3.5" />
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Select</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ToggleGroupItem
                aria-label="Text box"
                aria-pressed={activeTool === 'text'}
                disabled={!canUseTools || textEditActive}
                role="button"
                value="text"
              >
                <TypeIcon className="size-3.5" />
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Text box</TooltipContent>
        </Tooltip>
      </ToggleGroup>

      <ToolbarButton
        disabled={!canUseTools || textEditActive}
        label="Insert image"
        onClick={onPickImage}
      >
        <ImageIcon className="size-3.5" />
      </ToolbarButton>

      {selectedImage ? (
        <>
          <ButtonGroupSeparator
            className="h-5 bg-[var(--ark-titlebar-border)]"
            orientation="vertical"
          />
          <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--ark-titlebar-muted)]">
            <span className="sr-only">Image alt text</span>
            <span aria-hidden>Alt</span>
            <input
              className="h-6 min-w-0 max-w-40 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-2 text-[11px] text-[var(--ark-titlebar-fg)] outline-none"
              disabled={toolbarDisabled || textEditActive}
              onChange={(event) => onImageAltChange?.(event.target.value)}
              placeholder="Describe image"
              type="text"
              value={imageAlt}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--ark-titlebar-muted)]">
            <span className="sr-only">Image fit mode</span>
            <span aria-hidden>Fit</span>
            <select
              className="h-6 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-1.5 text-[11px] text-[var(--ark-titlebar-fg)] outline-none"
              disabled={toolbarDisabled || textEditActive}
              onChange={(event) => onImageFitChange?.(event.target.value as ImageFitMode)}
              value={imageFit}
            >
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Fill</option>
            </select>
          </label>
        </>
      ) : null}

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
          disabled={!canModifySelection}
          label={
            selectionUnsafe
              ? 'Delete selected elements (mixed or locked)'
              : selectionLocked
                ? 'Delete selected element (locked)'
                : hasSelection
                  ? 'Delete selected element'
                  : 'Delete selected element (no selection)'
          }
          onClick={onDelete}
        >
          <Trash2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!canModifySelection}
          label={
            hasSelection
              ? 'Duplicate selected element'
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
          disabled={!canReorderSelection}
          label={hasSelection ? 'Bring forward' : 'Bring forward (no selection)'}
          onClick={onBringForward}
        >
          <ArrowUpIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!canReorderSelection}
          label={hasSelection ? 'Send backward' : 'Send backward (no selection)'}
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
        <ToolbarButton disabled={undoDisabled} label="Undo" onClick={onUndo}>
          <Undo2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton disabled={redoDisabled} label="Redo" onClick={onRedo}>
          <Redo2Icon className="size-3.5" />
        </ToolbarButton>
      </ButtonGroup>

      <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-[var(--ark-titlebar-muted)]">
        {!hasDeck ? <span>No deck loaded</span> : null}
        {hasDeck && isGenerating ? <span>Editing paused during generation</span> : null}
        {selectionUnsafe ? <Badge variant="outline">Mixed selection</Badge> : null}
        {selectionLocked && !selectionUnsafe ? <Badge variant="outline">Locked</Badge> : null}
        {textEditActive ? <span>Editing text — press Escape to cancel</span> : null}
        {isSaving ? <span>Saving edit…</span> : null}
      </div>
    </div>
  )
}
