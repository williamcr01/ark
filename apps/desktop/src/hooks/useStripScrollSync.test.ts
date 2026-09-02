import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useStripScrollSync } from './useStripScrollSync'

describe('useStripScrollSync', () => {
  it('scrolls the active thumbnail into view while the strip is open', () => {
    const scrollIntoView = vi.fn()
    const activeItemRef = { current: { scrollIntoView } as unknown as HTMLElement }

    const { rerender } = renderHook(
      ({ activeIndex, isOpen, orientation }) =>
        useStripScrollSync({
          activeIndex,
          activeItemRef,
          isOpen,
          orientation,
        }),
      {
        initialProps: {
          activeIndex: 0,
          isOpen: true,
          orientation: 'vertical' as 'horizontal' | 'vertical',
        },
      },
    )

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })

    rerender({ activeIndex: 2, isOpen: true, orientation: 'horizontal' })
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    })
  })

  it('does not scroll while the strip is closed', () => {
    const scrollIntoView = vi.fn()
    const activeItemRef = { current: { scrollIntoView } as unknown as HTMLElement }

    renderHook(() =>
      useStripScrollSync({
        activeIndex: 1,
        activeItemRef,
        isOpen: false,
        orientation: 'vertical',
      }),
    )

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
