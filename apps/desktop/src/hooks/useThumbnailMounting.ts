import { useCallback, useMemo, useState } from 'react'

import { computeMountedIndices } from '@/lib/deck/thumbnail-strip'

export function useThumbnailMounting({
  activeIndex,
  isOpen,
  slideCount,
}: {
  activeIndex: number
  isOpen: boolean
  slideCount: number
}) {
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(() => new Set([0]))
  const [collapsedMountedIndices, setCollapsedMountedIndices] = useState<Set<number> | null>(null)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)

  const computedMountedIndices = useMemo(
    () => computeMountedIndices(slideCount, activeIndex, visibleIndices),
    [activeIndex, slideCount, visibleIndices],
  )

  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen)

    if (!isOpen) {
      setCollapsedMountedIndices(new Set(computedMountedIndices))
    } else {
      setCollapsedMountedIndices(null)
    }
  }

  const mountedIndices =
    isOpen || !collapsedMountedIndices ? computedMountedIndices : collapsedMountedIndices

  const handleVisibilityChange = useCallback((index: number, isVisible: boolean) => {
    setVisibleIndices((current) => {
      const hasIndex = current.has(index)

      if (isVisible === hasIndex) {
        return current
      }

      const next = new Set(current)

      if (isVisible) {
        next.add(index)
      } else {
        next.delete(index)
      }

      return next
    })
  }, [])

  return { handleVisibilityChange, mountedIndices }
}
