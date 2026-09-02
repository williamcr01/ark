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
import { DeckRestoreHistoryMenu } from '@/components/DeckRestoreHistoryMenu'
import type { EditorTool } from '@ark/editor-runtime'
import type { ImageFitMode } from '@ark/deck/document/image.ts'

import { ToolbarButton } from './EditModeToolbarButton.tsx'

export function EditModeToolGroup({
  activeTool,
  canUseTools,
  onPickImage,
  onToolChange,
  textEditActive,
}: {
  activeTool: EditorTool
  canUseTools: boolean
  onPickImage?: () => void
  onToolChange: (tool: EditorTool) => void
  textEditActive: boolean
}) {
  return (
    <>
      <ToggleGroup
        aria-label="Editor tools"
        onValueChange={(value) => {
          if (!value) return
          onToolChange(value as EditorTool)
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
    </>
  )
}

export function EditModeImageGroup({
  imageAlt,
  imageFit,
  onImageAltChange,
  onImageFitChange,
  textEditActive,
  toolbarDisabled,
}: {
  imageAlt: string
  imageFit: ImageFitMode
  onImageAltChange?: (alt: string) => void
  onImageFitChange?: (fit: ImageFitMode) => void
  textEditActive: boolean
  toolbarDisabled: boolean
}) {
  return (
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
  )
}

export function EditModeSelectionGroup({
  canModifySelection,
  canReorderSelection,
  hasSelection,
  onBringForward,
  onDelete,
  onDuplicate,
  onSendBackward,
  selectionLocked,
  selectionUnsafe,
}: {
  canModifySelection: boolean
  canReorderSelection: boolean
  hasSelection: boolean
  onBringForward?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onSendBackward?: () => void
  selectionLocked: boolean
  selectionUnsafe: boolean
}) {
  return (
    <>
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
    </>
  )
}

export function EditModeHistoryGroup({
  deckId,
  onRedo,
  onRestoreHistory,
  onUndo,
  redoDisabled,
  textEditActive,
  toolbarDisabled,
  undoDisabled,
}: {
  deckId: string | null
  onRedo: () => void
  onRestoreHistory?: (revision: number) => Promise<void>
  onUndo: () => void
  redoDisabled: boolean
  textEditActive: boolean
  toolbarDisabled: boolean
  undoDisabled: boolean
}) {
  return (
    <>
      <ButtonGroupSeparator
        className="h-5 bg-[var(--ark-titlebar-border)]"
        orientation="vertical"
      />

      <ButtonGroup aria-label="History" className="shrink-0">
        <ToolbarButton
          disabled={undoDisabled}
          label="Undo"
          onClick={onUndo}
          shortcuts="Control+Z Meta+Z"
        >
          <Undo2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={redoDisabled}
          label="Redo"
          onClick={onRedo}
          shortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        >
          <Redo2Icon className="size-3.5" />
        </ToolbarButton>
        {onRestoreHistory ? (
          <DeckRestoreHistoryMenu
            deckId={deckId}
            disabled={toolbarDisabled || textEditActive}
            onRestore={onRestoreHistory}
          />
        ) : null}
      </ButtonGroup>
    </>
  )
}

export function EditModeToolbarStatus({
  hasDeck,
  isGenerating,
  isSaving,
  selectionLocked,
  selectionUnsafe,
  textEditActive,
}: {
  hasDeck: boolean
  isGenerating: boolean
  isSaving: boolean
  selectionLocked: boolean
  selectionUnsafe: boolean
  textEditActive: boolean
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-[var(--ark-titlebar-muted)]">
      {!hasDeck ? <span>No deck loaded</span> : null}
      {hasDeck && isGenerating ? <span>Editing paused during generation</span> : null}
      {selectionUnsafe ? <Badge variant="outline">Mixed selection</Badge> : null}
      {selectionLocked && !selectionUnsafe ? <Badge variant="outline">Locked</Badge> : null}
      {textEditActive ? <span>Editing text — press Escape to cancel</span> : null}
      {isSaving ? <span>Saving edit…</span> : null}
    </div>
  )
}
