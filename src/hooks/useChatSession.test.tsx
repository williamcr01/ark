import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { clearChatSession, writeChatSession } from '@/lib/chat-session'
import { useChatSession } from '@/hooks/useChatSession'

describe('useChatSession', () => {
  afterEach(() => {
    clearChatSession()
  })

  it('restores persisted messages on mount', () => {
    writeChatSession({
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      updatedAt: new Date().toISOString(),
    })

    const { result } = renderHook(() => useChatSession())

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.content).toBe('hello')
  })

  it('clears persisted state when reset', () => {
    writeChatSession({
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      updatedAt: new Date().toISOString(),
    })

    const { result } = renderHook(() => useChatSession())

    act(() => {
      result.current.resetChat()
    })

    expect(result.current.messages).toEqual([])

    const { result: freshResult } = renderHook(() => useChatSession())
    expect(freshResult.current.messages).toEqual([])
  })
})
