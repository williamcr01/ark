import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { getTestLocalStorage } from '@/test/storage'

import { useChatPanelLayout } from './useChatPanelLayout'

const mediaState = vi.hoisted(() => ({ isDesktop: true }))

vi.mock('./useMediaQuery', () => ({
  useMediaQuery: (query: string) => (query.includes('1180') ? mediaState.isDesktop : false),
}))

vi.mock('./useElementSize', () => ({
  useElementSize: () => [{ current: null }, { width: 1280, height: 800 }],
}))

describe('useChatPanelLayout', () => {
  it('toggles chat open state and persists the preference', () => {
    mediaState.isDesktop = true
    const { result } = renderHook(() => useChatPanelLayout(true))

    expect(result.current.isChatOpen).toBe(true)

    act(() => {
      result.current.handleToggleChat()
    })

    expect(result.current.isChatOpen).toBe(false)
    expect(getTestLocalStorage().getItem('ark:chat-open')).toBe('0')
  })

  it('ignores the shortcut when it is disabled', () => {
    mediaState.isDesktop = true
    const { result } = renderHook(() => useChatPanelLayout(false))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }))
    })

    expect(result.current.isChatOpen).toBe(true)
  })
})
