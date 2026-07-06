import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearChatSession, writeChatSession } from '@/lib/chat-session'
import { useChatSession } from '@/hooks/useChatSession'

describe('useChatSession', () => {
  afterEach(() => {
    clearChatSession(null)
    clearChatSession('deck-1')
    clearChatSession('deck-2')
    vi.unstubAllGlobals()
  })

  it('loads deck chat from the backend when deckId is set', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        thread: null,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'hello',
            threadId: 'thread-1',
            deckId: 'deck-1',
            deckVersionId: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        hasMore: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1' }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.messages).toEqual([{ id: 'm1', role: 'user', content: 'hello' }])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/decks/deck-1/chat'),
      expect.any(Object),
    )
  })

  it('switches to a different deck thread when deckId changes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('deck-1')) {
        return {
          ok: true,
          json: async () => ({
            thread: null,
            messages: [
              {
                id: 'm1',
                role: 'user',
                content: 'deck one',
                threadId: 'thread-1',
                deckId: 'deck-1',
                deckVersionId: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            hasMore: false,
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          thread: null,
          messages: [
            {
              id: 'm2',
              role: 'user',
              content: 'deck two',
              threadId: 'thread-2',
              deckId: 'deck-2',
              deckVersionId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          hasMore: false,
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ deckId }: { deckId: string | null }) => useChatSession({ deckId }),
      { initialProps: { deckId: 'deck-1' as string | null } },
    )

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe('deck one')
    })

    rerender({ deckId: 'deck-2' })

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe('deck two')
    })
  })

  it('restores local new-deck chat when no deck id is active', () => {
    writeChatSession(null, {
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      updatedAt: new Date().toISOString(),
    })

    const { result } = renderHook(() => useChatSession({ deckId: null }))

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.content).toBe('hello')
  })

  it('clears persisted state when reset', async () => {
    writeChatSession('deck-1', {
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      updatedAt: new Date().toISOString(),
    })

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1' }))

    await act(async () => {
      await result.current.resetChat()
    })

    expect(result.current.messages).toEqual([])

    const { result: freshResult } = renderHook(() => useChatSession({ deckId: 'deck-1' }))
    expect(freshResult.current.messages).toEqual([])
  })

  it('reloads chat for an explicit deck id before the hook ref updates', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('deck-new')) {
        return {
          ok: true,
          json: async () => ({
            thread: null,
            messages: [
              {
                id: 'm-user',
                role: 'user',
                content: 'make slides',
                threadId: 'thread-new',
                deckId: 'deck-new',
                deckVersionId: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'm-assistant',
                role: 'assistant',
                content: 'Generated the deck.',
                threadId: 'thread-new',
                deckId: 'deck-new',
                deckVersionId: null,
                createdAt: '2026-01-01T00:00:01.000Z',
              },
            ],
            hasMore: false,
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({ thread: null, messages: [], hasMore: false }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: null }))

    await act(async () => {
      await result.current.reloadChat('deck-new')
    })

    expect(result.current.messages).toEqual([
      { id: 'm-user', role: 'user', content: 'make slides' },
      { id: 'm-assistant', role: 'assistant', content: 'Generated the deck.' },
    ])
  })

  it('persists appended messages to an explicit deck id before the hook ref updates', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/chat/messages') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            message: {
              id: '00000000-0000-4000-8000-000000000201',
              role: 'assistant',
              content: 'Loaded deck.html into the preview.',
              threadId: 'thread-new',
              deckId: 'deck-new',
              deckVersionId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({ thread: null, messages: [], hasMore: false }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: null }))

    await act(async () => {
      await result.current.appendMessage(
        {
          id: '00000000-0000-4000-8000-000000000201',
          role: 'assistant',
          content: 'Loaded deck.html into the preview.',
        },
        'deck-new',
      )
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/decks/deck-new/chat/messages'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Loaded deck.html into the preview.'),
      }),
    )
    expect(result.current.messages).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000201',
        role: 'assistant',
        content: 'Loaded deck.html into the preview.',
      },
    ])
  })
})
