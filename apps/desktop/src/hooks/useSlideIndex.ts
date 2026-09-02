import { useCallback, useEffect, useRef } from 'react'

import { mapPreservedSlideIndexFromHtml } from '@ark/deck-preview/slide-patch.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'
import { clampSlideIndex } from '@/lib/deck/slide-navigation-keys.ts'
import { useEditorStore } from '@/state/editor-store.ts'

export function useSlideIndex(
  slideCount: number,
  html: string,
  options: {
    initialSlideIndex?: number
    reloadRevision?: number
    sandboxOrigin?: string | null
    onSlideChange?: (index: number) => void
  } = {},
) {
  const { initialSlideIndex = 0, reloadRevision = 0, sandboxOrigin = null, onSlideChange } = options
  const seededInitialRef = useRef(false)
  if (!seededInitialRef.current) {
    seededInitialRef.current = true
    useEditorStore.getState().setActiveSlideIndex(clampSlideIndex(initialSlideIndex, slideCount))
  }
  const activeSlideIndex = useEditorStore((state) => state.activeSlideIndex)
  const prevHtmlRef = useRef(html)
  const prevReloadRevisionRef = useRef(reloadRevision)
  const appliedInitialSlideRef = useRef(html.length > 0)
  const activeSlideIndexRef = useRef(activeSlideIndex)
  const pendingFrameSyncIndexRef = useRef<number | null>(null)
  const onSlideChangeRef = useRef(onSlideChange)
  onSlideChangeRef.current = onSlideChange

  const commitSlideIndex = useCallback(
    (index: number, boundSlideCount = slideCount) => {
      const clampedIndex = clampSlideIndex(index, boundSlideCount)

      if (activeSlideIndexRef.current === clampedIndex) {
        useEditorStore.getState().setActiveSlideIndex(clampedIndex)
        return
      }

      activeSlideIndexRef.current = clampedIndex
      useEditorStore.getState().setActiveSlideIndex(clampedIndex)
      onSlideChangeRef.current?.(clampedIndex)
    },
    [slideCount],
  )

  useEffect(() => {
    activeSlideIndexRef.current = activeSlideIndex
  }, [activeSlideIndex])

  useEffect(() => {
    pendingFrameSyncIndexRef.current = null
  }, [html, reloadRevision, sandboxOrigin, slideCount])

  useEffect(() => {
    if (prevHtmlRef.current === html) {
      return
    }

    const previousHtml = prevHtmlRef.current
    prevHtmlRef.current = html

    if (!html) {
      appliedInitialSlideRef.current = false
      commitSlideIndex(0)
      return
    }

    if (!previousHtml && !appliedInitialSlideRef.current) {
      appliedInitialSlideRef.current = true
      commitSlideIndex(initialSlideIndex)
      return
    }

    const preservedIndex = mapPreservedSlideIndexFromHtml(
      previousHtml,
      html,
      activeSlideIndexRef.current,
      slideCount,
      { assetOrigin: resolveAppOrigin() },
    )
    commitSlideIndex(preservedIndex)
    pendingFrameSyncIndexRef.current = preservedIndex
  }, [commitSlideIndex, html, initialSlideIndex, slideCount])

  useEffect(() => {
    if (prevReloadRevisionRef.current === reloadRevision) {
      return
    }

    prevReloadRevisionRef.current = reloadRevision

    if (!html) {
      return
    }

    commitSlideIndex(clampSlideIndex(activeSlideIndexRef.current, slideCount))
    pendingFrameSyncIndexRef.current = clampSlideIndex(activeSlideIndexRef.current, slideCount)
  }, [commitSlideIndex, html, reloadRevision, slideCount])

  useEffect(() => {
    commitSlideIndex(activeSlideIndexRef.current)
  }, [commitSlideIndex, slideCount])

  return {
    activeSlideIndex,
    activeSlideIndexRef,
    commitSlideIndex,
    pendingFrameSyncIndexRef,
  }
}
