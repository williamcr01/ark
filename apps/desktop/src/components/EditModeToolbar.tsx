import { TypeIcon } from 'lucide-react'

import { ButtonGroupSeparator } from '@/components/ui/button-group'
import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import type { EditorTool } from '@ark/editor-runtime'
import type { ImageFitMode } from '@ark/deck/document/image.ts'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'

import { ToolbarButton } from './EditModeToolbarButton.tsx'
import {
  EditModeHistoryGroup,
  EditModeImageGroup,
  EditModeSelectionGroup,
  EditModeToolGroup,
  EditModeToolbarStatus,
} from './EditModeToolbarGroups.tsx'

export type EditModeToolbarActions = {
  onBringForward?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onEditText?: () => void
  onImageAltChange?: (alt: string) => void
  onImageFitChange?: (fit: ImageFitMode) => void
  onPickImage?: () => void
  onSendBackward?: () => void
  onToolChange: (tool: EditorTool) => void
  onRestoreHistory?: (revision: number) => Promise<void>
}

type EditModeToolbarProps = {
  state: {
    canEditText: boolean
    hasDeck: boolean
    hasSelection: boolean
    selectedImage: boolean
    selectionLocked: boolean
    selectionManaged: boolean
    selectionUnsafe?: boolean
  }
  imageAlt?: string
  imageFit?: ImageFitMode
  actions: EditModeToolbarActions
}

export function EditModeToolbar({
  state,
  imageAlt = '',
  imageFit = 'contain',
  actions,
}: EditModeToolbarProps) {
  const {
    onBringForward,
    onDelete,
    onDuplicate,
    onEditText,
    onImageAltChange,
    onImageFitChange,
    onPickImage,
    onSendBackward,
    onToolChange,
    onRestoreHistory,
  } = actions
  const {
    canEditText,
    hasDeck,
    hasSelection,
    selectedImage,
    selectionLocked,
    selectionManaged,
    selectionUnsafe = false,
  } = state
  const deckId = useDeckStore((store) => store.deckId)
  const isSaving = useDeckStore((store) => store.isPatching || store.isSaving)
  const isGenerating = useChatStore((store) => store.isGenerating)
  const activeTool = useEditorStore((store) => store.selectedTool)
  const textEditActive = useEditorStore((store) => store.textEditActive)
  const edits = useManualEditCommits()
  const toolbarDisabled = !hasDeck || isGenerating || isSaving
  const canModifySelection =
    hasSelection && !selectionLocked && !selectionUnsafe && !toolbarDisabled && !textEditActive
  const canReorderSelection = canModifySelection && selectionManaged
  const canUseTools = hasDeck && !isGenerating && !isSaving
  const undoDisabled = !edits.canUndo || toolbarDisabled || textEditActive
  const redoDisabled = !edits.canRedo || toolbarDisabled || textEditActive

  return (
    <div
      aria-label="Edit mode toolbar"
      className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3"
      role="toolbar"
    >
      <EditModeToolGroup
        activeTool={activeTool}
        canUseTools={canUseTools}
        onPickImage={onPickImage}
        onToolChange={onToolChange}
        textEditActive={textEditActive}
      />

      {selectedImage ? (
        <EditModeImageGroup
          imageAlt={imageAlt}
          imageFit={imageFit}
          onImageAltChange={onImageAltChange}
          onImageFitChange={onImageFitChange}
          textEditActive={textEditActive}
          toolbarDisabled={toolbarDisabled}
        />
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

      <EditModeSelectionGroup
        canModifySelection={canModifySelection}
        canReorderSelection={canReorderSelection}
        hasSelection={hasSelection}
        onBringForward={onBringForward}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onSendBackward={onSendBackward}
        selectionLocked={selectionLocked}
        selectionUnsafe={selectionUnsafe}
      />

      <EditModeHistoryGroup
        deckId={deckId}
        onRedo={edits.handleRedoEdit}
        onRestoreHistory={onRestoreHistory}
        onUndo={edits.handleUndoEdit}
        redoDisabled={redoDisabled}
        textEditActive={textEditActive}
        toolbarDisabled={toolbarDisabled}
        undoDisabled={undoDisabled}
      />

      <EditModeToolbarStatus
        hasDeck={hasDeck}
        isGenerating={isGenerating}
        isSaving={isSaving}
        selectionLocked={selectionLocked}
        selectionUnsafe={selectionUnsafe}
        textEditActive={textEditActive}
      />
    </div>
  )
}
