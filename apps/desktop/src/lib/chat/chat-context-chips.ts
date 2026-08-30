import type { EditorSelectionContext, SlideContext } from '@ark/chat/chat.ts'
import type { ContextChipElement, ContextChipSlide } from '@/components/ChatContextChips'

/** Map persisted/job context into chip props for history rendering. */
export function contextToChipProps(context: {
  editorSelection?: EditorSelectionContext
  slideContexts?: SlideContext[]
}): { element: ContextChipElement | null; slides: ContextChipSlide[] } {
  const element = context.editorSelection
    ? {
        slideIndex: context.editorSelection.slideIndex,
        kind: context.editorSelection.elementKind || context.editorSelection.elementRole,
        textPreview: context.editorSelection.textPreview,
      }
    : null

  const slides =
    context.slideContexts?.map((slide) => ({
      slideIndex: slide.slideIndex,
      title: slide.title,
    })) ?? []

  return { element, slides }
}
