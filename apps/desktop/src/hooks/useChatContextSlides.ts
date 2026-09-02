import { useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { MAX_SLIDE_CONTEXTS } from '@ark/contracts'
import type { EditorSelectionInfo } from '@ark/editor-runtime'
import {
  extractSlideTitleFromOuterHtml,
  resolveContextSlides,
  sameContextSlideEntries,
} from '@/lib/deck/slide-context'
import { useEditorStore } from '@/state/editor-store.ts'

import { useDeckAnalysis } from './useDeckAnalysis'

export function useChatContextSlides() {
  const deckAnalysis = useDeckAnalysis()
  const editorSelection = useEditorStore((state) => state.editorSelection)
  const editorSelections = useEditorStore((state) => state.editorSelections)
  const contextSlideEntries = useEditorStore((state) => state.contextSlides)
  const clearEditorSelectionRef = useRef<(() => boolean) | null>(null)

  const handleEditorSelectionChange = useCallback(
    (selection: EditorSelectionInfo | null, selections: EditorSelectionInfo[] = []) => {
      useEditorStore.getState().select(selection, selections)
    },
    [],
  )

  const handleClearEditorSelection = useCallback(() => {
    const clear = clearEditorSelectionRef.current
    if (clear?.()) {
      return
    }
    useEditorStore.getState().clearSelection()
  }, [])

  const handleToggleContextSlide = useCallback(
    (slideIndex: number) => {
      const result = useEditorStore
        .getState()
        .toggleContextSlide(slideIndex, deckAnalysis.slides, MAX_SLIDE_CONTEXTS)
      if (result.capped) {
        toast.warning(`You can attach up to ${MAX_SLIDE_CONTEXTS} slides to the chat`)
      }
    },
    [deckAnalysis.slides],
  )

  const handleRemoveContextSlide = useCallback(
    (slideIndex: number) => {
      useEditorStore
        .getState()
        .setContextSlides((current) =>
          resolveContextSlides(current, deckAnalysis.slides).filter(
            (entry) => entry.slideIndex !== slideIndex,
          ),
        )
    },
    [deckAnalysis.slides],
  )

  const handleClearContextSlides = useCallback(() => {
    useEditorStore.getState().setContextSlides([])
  }, [])

  const resolvedContextSlides = useMemo(
    () => resolveContextSlides(contextSlideEntries, deckAnalysis.slides),
    [contextSlideEntries, deckAnalysis.slides],
  )
  if (!sameContextSlideEntries(resolvedContextSlides, contextSlideEntries)) {
    useEditorStore.getState().setContextSlides(resolvedContextSlides)
  }

  const contextSlideIndexes = useMemo(
    () => resolvedContextSlides.map((entry) => entry.slideIndex),
    [resolvedContextSlides],
  )

  const contextSlidesForChips = useMemo(
    () =>
      resolvedContextSlides.flatMap((entry) => {
        const slide = deckAnalysis.slides.find((item) => item.index === entry.slideIndex)
        if (!slide) {
          return []
        }
        return [
          {
            slideIndex: entry.slideIndex,
            title: extractSlideTitleFromOuterHtml(slide.outerHTML, entry.slideIndex),
          },
        ]
      }),
    [deckAnalysis.slides, resolvedContextSlides],
  )

  return {
    editorSelection,
    editorSelections,
    contextSlideIndexes,
    contextSlidesForChips,
    clearEditorSelectionRef,
    handleEditorSelectionChange,
    handleClearEditorSelection,
    handleToggleContextSlide,
    handleRemoveContextSlide,
    handleClearContextSlides,
  }
}
