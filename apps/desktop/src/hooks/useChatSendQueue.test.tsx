import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { QueuedChatSend } from '@/lib/chat/chat-send-queue'

import { useChatSendQueue, useFlushQueuedChatSends } from './useChatSendQueue'

function makeItem(overrides: Partial<QueuedChatSend> = {}): Omit<QueuedChatSend, 'id'> & {
  id?: string
} {
  return {
    text: 'follow up',
    attachments: [],
    assetIds: [],
    ...overrides,
  }
}

function createSendMock() {
  return vi.fn<(item: QueuedChatSend) => Promise<void>>(async () => undefined)
}

describe('useChatSendQueue', () => {
  it('enqueues messages in insertion order', () => {
    const { result } = renderHook(() => useChatSendQueue())

    act(() => {
      result.current.enqueue(makeItem({ id: 'a', text: 'first' }))
      result.current.enqueue(makeItem({ id: 'b', text: 'second' }))
    })

    expect(result.current.items.map((item) => item.text)).toEqual(['first', 'second'])
  })

  it('dismisses a queued message', () => {
    const { result } = renderHook(() => useChatSendQueue())

    act(() => {
      result.current.enqueue(makeItem({ id: 'a', text: 'keep' }))
      result.current.enqueue(makeItem({ id: 'b', text: 'drop' }))
      result.current.dismiss('b')
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['a'])
  })

  it('edits queued text in place', () => {
    const { result } = renderHook(() => useChatSendQueue())

    act(() => {
      result.current.enqueue(makeItem({ id: 'a', text: 'old' }))
      result.current.updateText('a', 'new copy')
    })

    expect(result.current.items[0]?.text).toBe('new copy')
  })

  it('moves Send now to the front of the queue', () => {
    const { result } = renderHook(() => useChatSendQueue())

    act(() => {
      result.current.enqueue(makeItem({ id: 'a', text: 'first' }))
      result.current.enqueue(makeItem({ id: 'b', text: 'second' }))
      result.current.enqueue(makeItem({ id: 'c', text: 'third' }))
      result.current.moveToFront('c')
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('takeNext drains from the front', () => {
    const { result } = renderHook(() => useChatSendQueue())

    act(() => {
      result.current.enqueue(makeItem({ id: 'a', text: 'first' }))
      result.current.enqueue(makeItem({ id: 'b', text: 'second' }))
    })

    act(() => {
      expect(result.current.takeNext()).toMatchObject({ id: 'a', text: 'first' })
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['b'])
  })
})

describe('useFlushQueuedChatSends', () => {
  it('does not flush while busy', async () => {
    const send = createSendMock()
    const { result } = renderHook(
      ({ busy }: { busy: boolean }) => {
        const queue = useChatSendQueue()
        const flush = useFlushQueuedChatSends(queue, busy, send)
        return { queue, flush }
      },
      { initialProps: { busy: true } },
    )

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'parked' }))
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(send).not.toHaveBeenCalled()
    expect(result.current.queue.items).toHaveLength(1)
  })

  it('flushes queued messages in order once idle', async () => {
    const send = createSendMock()
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => {
        const queue = useChatSendQueue()
        const flush = useFlushQueuedChatSends(queue, busy, send)
        return { queue, flush }
      },
      { initialProps: { busy: true } },
    )

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'first' }))
      result.current.queue.enqueue(makeItem({ id: 'b', text: 'second' }))
    })

    rerender({ busy: false })

    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls[0]?.[0]).toMatchObject({ id: 'a', text: 'first' })
    expect(send.mock.calls[1]?.[0]).toMatchObject({ id: 'b', text: 'second' })
    expect(result.current.queue.items).toHaveLength(0)
  })

  it('Send now while busy reorders; idle dequeues into the send path in that order', async () => {
    const send = createSendMock()
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => {
        const queue = useChatSendQueue()
        const flush = useFlushQueuedChatSends(queue, busy, send)
        return { queue, flush }
      },
      { initialProps: { busy: true } },
    )

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'first' }))
      result.current.queue.enqueue(makeItem({ id: 'b', text: 'steer me' }))
    })

    await act(async () => {
      await result.current.flush.sendNow('b')
    })

    expect(send).not.toHaveBeenCalled()
    expect(result.current.queue.items.map((item) => item.id)).toEqual(['b', 'a'])

    rerender({ busy: false })

    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls[0]?.[0]).toMatchObject({ id: 'b', text: 'steer me' })
    expect(send.mock.calls[1]?.[0]).toMatchObject({ id: 'a', text: 'first' })
  })

  it('Send now while idle dequeues that chip into the send path', async () => {
    const send = createSendMock()
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => {
        const queue = useChatSendQueue()
        const flush = useFlushQueuedChatSends(queue, busy, send)
        return { queue, flush }
      },
      { initialProps: { busy: true } },
    )

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'later' }))
      result.current.queue.enqueue(makeItem({ id: 'b', text: 'now' }))
    })

    rerender({ busy: false })

    await act(async () => {
      await result.current.flush.sendNow('b')
    })

    await waitFor(() => {
      expect(send.mock.calls.some((call) => call[0]?.id === 'b')).toBe(true)
    })
  })

  it('Send all while busy leaves the queue for the idle flush, preserving order', async () => {
    const send = createSendMock()
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => {
        const queue = useChatSendQueue()
        const flush = useFlushQueuedChatSends(queue, busy, send)
        return { queue, flush }
      },
      { initialProps: { busy: true } },
    )

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'one' }))
      result.current.queue.enqueue(makeItem({ id: 'b', text: 'two' }))
    })

    await act(async () => {
      await result.current.flush.sendAll()
    })
    expect(send).not.toHaveBeenCalled()

    rerender({ busy: false })

    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls.map((call) => call[0]?.text)).toEqual(['one', 'two'])
  })

  it('Send all while idle drains the queue in order', async () => {
    const send = createSendMock()

    const { result } = renderHook(() => {
      const queue = useChatSendQueue()
      const flush = useFlushQueuedChatSends(queue, false, send)
      return { queue, flush }
    })

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'one' }))
      result.current.queue.enqueue(makeItem({ id: 'b', text: 'two' }))
    })

    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls.map((call) => call[0]?.text)).toEqual(['one', 'two'])
  })

  it('dismissed messages are not flushed', async () => {
    const send = createSendMock()
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => {
        const queue = useChatSendQueue()
        const flush = useFlushQueuedChatSends(queue, busy, send)
        return { queue, flush }
      },
      { initialProps: { busy: true } },
    )

    act(() => {
      result.current.queue.enqueue(makeItem({ id: 'a', text: 'drop' }))
      result.current.queue.enqueue(makeItem({ id: 'b', text: 'keep' }))
      result.current.queue.dismiss('a')
    })

    rerender({ busy: false })

    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    expect(send.mock.calls[0]?.[0]).toMatchObject({ id: 'b', text: 'keep' })
  })
})
