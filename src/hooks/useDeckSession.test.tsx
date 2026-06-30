import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { clearDeckSession, writeDeckSession } from '@/lib/deck-session'
import { useDeckSession } from '@/hooks/useDeckSession'

describe('useDeckSession', () => {
  afterEach(() => {
    clearDeckSession()
  })

  it('restores persisted html and messages on mount', () => {
    writeDeckSession({
      id: 'session-1',
      html: '<html><body>deck</body></html>',
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      updatedAt: new Date().toISOString(),
    })

    const { result } = renderHook(() => useDeckSession())

    expect(result.current.html).toContain('<html>')
    expect(result.current.messages).toHaveLength(1)
  })

  it('clears persisted state when reset', () => {
    writeDeckSession({
      id: 'session-1',
      html: '<html><body>deck</body></html>',
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      updatedAt: new Date().toISOString(),
    })

    const { result } = renderHook(() => useDeckSession())

    act(() => {
      result.current.resetSession()
    })

    expect(result.current.html).toBe('')
    expect(result.current.messages).toEqual([])

    clearDeckSession()
    const { result: freshResult } = renderHook(() => useDeckSession())
    expect(freshResult.current.messages).toEqual([])
    expect(freshResult.current.html).toBe('')
  })
})
