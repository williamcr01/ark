import { renderHook } from '@testing-library/react'
import { type KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useThumbnailKeyboardNav } from './useThumbnailKeyboardNav'

function keyEvent(key: string, altKey = false) {
  return {
    altKey,
    key,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLButtonElement>
}

describe('useThumbnailKeyboardNav', () => {
  it('reorders with alt-arrow and traps the matching edge shortcut', () => {
    const commitReorder = vi.fn()
    const onReorder = vi.fn()
    const { result } = renderHook(() =>
      useThumbnailKeyboardNav({
        commitReorder,
        onReorder,
        orientation: 'vertical',
        slideCount: 3,
      }),
    )

    const down = keyEvent('ArrowDown', true)
    result.current.handleKeyboardReorder(0, down)
    expect(down.preventDefault).toHaveBeenCalled()
    expect(commitReorder).toHaveBeenCalledWith(0, 1, true)

    const edge = keyEvent('ArrowDown', true)
    result.current.handleKeyboardReorder(2, edge)
    expect(edge.preventDefault).toHaveBeenCalled()
    expect(commitReorder).toHaveBeenCalledWith(2, 2, true)
  })

  it('ignores home, end, and delete, and skips reorder when no callback is provided', () => {
    const commitReorder = vi.fn()
    const { result } = renderHook(() =>
      useThumbnailKeyboardNav({
        commitReorder,
        onReorder: commitReorder,
        orientation: 'vertical',
        slideCount: 3,
      }),
    )

    for (const key of ['Home', 'End', 'Delete'] as const) {
      const event = keyEvent(key)
      result.current.handleKeyboardReorder(1, event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }

    expect(commitReorder).not.toHaveBeenCalled()
  })

  it('does nothing when onReorder is omitted', () => {
    const commitReorder = vi.fn()
    const { result } = renderHook(() =>
      useThumbnailKeyboardNav({
        commitReorder,
        orientation: 'vertical',
        slideCount: 3,
      }),
    )

    const blocked = keyEvent('ArrowDown', true)
    result.current.handleKeyboardReorder(0, blocked)
    expect(blocked.preventDefault).not.toHaveBeenCalled()
    expect(commitReorder).not.toHaveBeenCalled()
  })

  it('uses left and right arrows in the horizontal strip', () => {
    const commitReorder = vi.fn()
    const { result } = renderHook(() =>
      useThumbnailKeyboardNav({
        commitReorder,
        onReorder: vi.fn(),
        orientation: 'horizontal',
        slideCount: 3,
      }),
    )

    result.current.handleKeyboardReorder(2, keyEvent('ArrowLeft', true))
    expect(commitReorder).toHaveBeenCalledWith(2, 1, true)
  })
})
