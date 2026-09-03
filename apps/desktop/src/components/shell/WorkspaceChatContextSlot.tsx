import { ChatContextChips } from '@/components/ChatContextChips'
import type { useChatContextSlides } from '@/hooks/useChatContextSlides'

type WorkspaceChatContextSlotProps = {
  context: ReturnType<typeof useChatContextSlides>
}

export function WorkspaceChatContextSlot({ context }: WorkspaceChatContextSlotProps) {
  const hasSelection =
    context.editorSelection ||
    context.editorSelections.length > 0 ||
    context.contextSlidesForChips.length > 0

  if (!hasSelection) {
    return null
  }

  return (
    <ChatContextChips
      editorSelection={context.editorSelection}
      editorSelections={context.editorSelections}
      nested
      onClearEditorSelection={context.handleClearEditorSelection}
      onClearSlides={context.handleClearContextSlides}
      onRemoveSlide={context.handleRemoveContextSlide}
      slides={context.contextSlidesForChips}
    />
  )
}
