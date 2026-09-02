import { useCallback, type KeyboardEvent } from 'react'

import {
  resolveThumbnailKeyboardAction,
  type ThumbnailOrientation,
} from '@/lib/deck/thumbnail-strip'

type UseThumbnailKeyboardNavArgs = {
  commitReorder: (
    fromIndex: number,
    toIndex: number,
    focusDestination?: boolean,
  ) => void | Promise<unknown>
  onReorder?: (fromIndex: number, toIndex: number) => void | Promise<unknown>
  orientation: ThumbnailOrientation
  slideCount: number
}

export function useThumbnailKeyboardNav({
  commitReorder,
  onReorder,
  orientation,
  slideCount,
}: UseThumbnailKeyboardNavArgs) {
  const handleKeyboardReorder = useCallback(
    (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (!onReorder) return

      const action = resolveThumbnailKeyboardAction({
        altKey: event.altKey,
        index,
        key: event.key,
        orientation,
        slideCount,
      })

      if (action.type !== 'reorder') return

      event.preventDefault()
      void commitReorder(action.fromIndex, action.toIndex, true)
    },
    [commitReorder, onReorder, orientation, slideCount],
  )

  return { handleKeyboardReorder }
}
