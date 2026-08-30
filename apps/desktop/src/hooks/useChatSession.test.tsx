import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearChatSession, readChatSession, writeChatSession } from '@/lib/chat/chat-session'
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
            documentRevision: null,
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
                documentRevision: null,
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
              documentRevision: null,
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

  it('shows the local cache for the next deck immediately on switch', async () => {
    writeChatSession('deck-1', {
      messages: [{ id: 'm1', role: 'user', content: 'deck one' }],
      updatedAt: new Date().toISOString(),
    })
    writeChatSession('deck-2', {
      messages: [{ id: 'm2', role: 'user', content: 'deck two cached' }],
      updatedAt: new Date().toISOString(),
    })

    let resolveDeck2: ((value: unknown) => void) | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('deck-2')) {
        await new Promise((resolve) => {
          resolveDeck2 = resolve
        })
        return {
          ok: true,
          json: async () => ({
            thread: null,
            messages: [
              {
                id: 'm2',
                role: 'user',
                content: 'deck two server',
                threadId: 'thread-2',
                deckId: 'deck-2',
                documentRevision: null,
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
              id: 'm1',
              role: 'user',
              content: 'deck one',
              threadId: 'thread-1',
              deckId: 'deck-1',
              documentRevision: null,
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
      expect(result.current.messages[0]?.content).toBe('deck two cached')
    })
    expect(readChatSession('deck-2')?.messages[0]?.content).toBe('deck two cached')

    await act(async () => {
      resolveDeck2?.(undefined)
    })

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe('deck two server')
    })
  })

  it('keeps an unsaved in-flight thread when a new deck id appears', async () => {
    const fetchMock = vi.fn(async () => ({
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
            documentRevision: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'job-1',
            role: 'assistant',
            content: 'Generated the deck.',
            threadId: 'thread-new',
            deckId: 'deck-new',
            documentRevision: null,
            createdAt: '2026-01-01T00:00:01.000Z',
          },
        ],
        hasMore: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ deckId }: { deckId: string | null }) => useChatSession({ deckId }),
      { initialProps: { deckId: null as string | null } },
    )

    await act(async () => {
      result.current.setMessages([
        { id: 'm-user', role: 'user', content: 'make slides' },
        { id: 'job-1', role: 'assistant', content: 'Generated the deck.' },
      ])
    })

    rerender({ deckId: 'deck-new' })

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { id: 'm-user', role: 'user', content: 'make slides' },
        { id: 'job-1', role: 'assistant', content: 'Generated the deck.' },
      ])
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

  it('starts a fresh unsaved chat without clearing the previous deck chat', async () => {
    writeChatSession(null, {
      messages: [{ id: 'stale', role: 'user', content: 'old unsaved prompt' }],
      updatedAt: new Date().toISOString(),
    })

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        thread: null,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'saved deck prompt',
            threadId: 'thread-1',
            deckId: 'deck-1',
            documentRevision: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        hasMore: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ deckId }: { deckId: string | null }) => useChatSession({ deckId }),
      { initialProps: { deckId: 'deck-1' as string | null } },
    )

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe('saved deck prompt')
    })

    await act(async () => {
      await result.current.resetChat(null)
      rerender({ deckId: null })
    })

    expect(result.current.messages).toEqual([])
    expect(readChatSession(null)?.messages).toEqual([])
    expect(readChatSession('deck-1')?.messages).toEqual([
      { id: 'm1', role: 'user', content: 'saved deck prompt' },
    ])
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/decks/deck-1/chat'),
      expect.objectContaining({ method: 'DELETE' }),
    )
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
                documentRevision: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'm-assistant',
                role: 'assistant',
                content: 'Generated the deck.',
                threadId: 'thread-new',
                deckId: 'deck-new',
                documentRevision: null,
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
              documentRevision: null,
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

  it('marks append failures and exposes them from the hook', async () => {
    const onPersistFailure = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/chat/messages') && init?.method === 'POST') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        }
      }

      return {
        ok: true,
        json: async () => ({ thread: null, messages: [], hasMore: false }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1', onPersistFailure }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.appendMessage({
        id: '00000000-0000-4000-8000-000000000101',
        role: 'user',
        content: 'hello',
      })
    })

    expect(result.current.messages).toEqual([
      { id: '00000000-0000-4000-8000-000000000101', role: 'user', content: 'hello' },
    ])
    expect(result.current.failedPersistIds).toEqual(
      new Set(['00000000-0000-4000-8000-000000000101']),
    )
    expect(result.current.getMessageDeliveryStatus('00000000-0000-4000-8000-000000000101')).toBe(
      'failed',
    )
    expect(onPersistFailure).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000101')
  })

  it('retries failed persists and clears the failure marker on success', async () => {
    let appendAttempts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/chat/messages') && init?.method === 'POST') {
        appendAttempts += 1

        if (appendAttempts === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Server error' }),
          }
        }

        return {
          ok: true,
          status: 201,
          json: async () => ({
            message: {
              id: '00000000-0000-4000-8000-000000000101',
              role: 'user',
              content: 'hello',
              threadId: 'thread-1',
              deckId: 'deck-1',
              documentRevision: null,
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

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1' }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.appendMessage({
        id: '00000000-0000-4000-8000-000000000101',
        role: 'user',
        content: 'hello',
      })
    })

    expect(result.current.failedPersistIds.size).toBe(1)

    await act(async () => {
      await result.current.retryPersist('00000000-0000-4000-8000-000000000101')
    })

    expect(appendAttempts).toBe(2)
    expect(result.current.failedPersistIds.size).toBe(0)
    expect(result.current.getMessageDeliveryStatus('00000000-0000-4000-8000-000000000101')).toBe(
      'saved',
    )
  })

  it('keeps failed messages when reloadChat succeeds', async () => {
    writeChatSession('deck-1', {
      messages: [
        { id: 'm1', role: 'user', content: 'synced' },
        { id: 'm2', role: 'user', content: 'unsynced' },
      ],
      failedPersistIds: ['m2'],
      updatedAt: new Date().toISOString(),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/chat')) {
        return {
          ok: true,
          json: async () => ({
            thread: null,
            messages: [
              {
                id: 'm1',
                role: 'user',
                content: 'synced',
                threadId: 'thread-1',
                deckId: 'deck-1',
                documentRevision: null,
                createdAt: '2026-01-01T00:00:00.000Z',
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

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1' }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.messages).toEqual([
      { id: 'm1', role: 'user', content: 'synced' },
      { id: 'm2', role: 'user', content: 'unsynced' },
    ])
    expect(result.current.failedPersistIds).toEqual(new Set(['m2']))

    await act(async () => {
      await result.current.reloadChat('deck-1')
    })

    expect(result.current.messages).toEqual([
      { id: 'm1', role: 'user', content: 'synced' },
      { id: 'm2', role: 'user', content: 'unsynced' },
    ])
    expect(result.current.failedPersistIds).toEqual(new Set(['m2']))
  })

  it('does not resurrect stale cached messages cleared on the server', async () => {
    writeChatSession('deck-1', {
      messages: [
        { id: 'm1', role: 'user', content: 'old cache' },
        { id: 'm2', role: 'assistant', content: 'also stale' },
      ],
      updatedAt: new Date().toISOString(),
    })

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        thread: null,
        messages: [],
        hasMore: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1' }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.messages).toEqual([])
    expect(result.current.failedPersistIds).toEqual(new Set())
  })

  it('surfaces reset failures through the callback', async () => {
    const onResetFailure = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/chat') && init?.method === 'DELETE') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        }
      }

      return {
        ok: true,
        json: async () => ({ thread: null, messages: [], hasMore: false }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatSession({ deckId: 'deck-1', onResetFailure }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      const succeeded = await result.current.resetChat()
      expect(succeeded).toBe(false)
    })

    expect(result.current.messages).toEqual([])
    expect(onResetFailure).toHaveBeenCalledTimes(1)
  })
})
