import type { EditorSelectionContext, SlideContext } from '@ark/chat/context.ts'
import type { ContextChipElement, ContextChipSlide } from '@/components/ChatContextChips'

/** Map persisted/job context into chip props for history rendering. */
export function contextToChipProps(context: {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  slideContexts?: SlideContext[]
}): { element: ContextChipElement | null; elementCount?: number; slides: ContextChipSlide[] } {
  const set =
    context.editorSelections && context.editorSelections.length > 0
      ? context.editorSelections
      : context.editorSelection
        ? [context.editorSelection]
        : []
  const primary =
    (context.editorSelection &&
    set.some((item) => item.elementId === context.editorSelection?.elementId)
      ? context.editorSelection
      : set[set.length - 1]) ?? null

  const element = primary
    ? {
        slideIndex: primary.slideIndex,
        kind: primary.elementKind || primary.elementRole,
        textPreview: primary.textPreview,
      }
    : null

  const slides =
    context.slideContexts?.map((slide) => ({
      slideIndex: slide.slideIndex,
      title: slide.title,
    })) ?? []

  return {
    element,
    ...(set.length > 1 ? { elementCount: set.length } : {}),
    slides,
  }
}
