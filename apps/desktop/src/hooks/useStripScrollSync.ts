import { useEffect, type RefObject } from 'react'

import type { ThumbnailOrientation } from '@/lib/deck/thumbnail-strip'

export function useStripScrollSync({
  activeIndex,
  activeItemRef,
  isOpen,
  orientation,
}: {
  activeIndex: number
  activeItemRef: RefObject<HTMLElement | null>
  isOpen: boolean
  orientation: ThumbnailOrientation
}) {
  useEffect(() => {
    if (!isOpen) {
      return
    }

    activeItemRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: orientation === 'vertical' ? 'nearest' : 'center',
      inline: orientation === 'horizontal' ? 'center' : 'nearest',
    })
  }, [activeIndex, activeItemRef, isOpen, orientation])
}
