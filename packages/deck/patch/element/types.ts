export type ParseFragment = (html: string) => Document

export type ElementPatchContext = {
  doc: Document
  slides: Element[]
  changedSlideIndexes: Set<number>
  changedElementIds: Set<string>
  summaries: string[]
  activeSlideIndex?: number
  parseFragment: ParseFragment
}

export type ResolvedElement = {
  element: Element
  slide: Element
  slideIndex: number
}

export type ElementTarget = {
  slideIndex?: number
  slideId?: string
  elementId: string
}

export function markElementChanged(
  context: ElementPatchContext,
  slideIndex: number,
  elementId: string,
) {
  context.changedSlideIndexes.add(slideIndex)
  context.changedElementIds.add(elementId)
}
