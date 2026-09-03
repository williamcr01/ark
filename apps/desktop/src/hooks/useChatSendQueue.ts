import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { QueuedChatSend } from '@/lib/chat/chat-send-queue'
import { useChatStore } from '@/state/chat-store.ts'

export type ChatSendQueueItem = QueuedChatSend

export type UseChatSendQueueResult = {
  items: ChatSendQueueItem[]
  clear: () => void
  dismiss: (id: string) => void
  enqueue: (item: Omit<ChatSendQueueItem, 'id'> & { id?: string }) => ChatSendQueueItem
  moveToFront: (id: string) => void
  take: (id: string) => ChatSendQueueItem | null
  takeNext: () => ChatSendQueueItem | null
  updateText: (id: string, text: string) => void
}

export function useChatSendQueue(): UseChatSendQueueResult {
  const items = useChatStore((state) => state.queuedSends)
  const enqueue = useChatStore((state) => state.enqueueSend)
  const dismiss = useChatStore((state) => state.dequeueSend)
  const updateText = useChatStore((state) => state.updateSendText)
  const moveToFront = useChatStore((state) => state.moveSendToFront)
  const take = useChatStore((state) => state.dequeueSend)
  const takeNext = useChatStore((state) => state.dequeueNextSend)
  const clear = useChatStore((state) => state.clearSends)

  return useMemo(
    () => ({
      items,
      clear,
      dismiss,
      enqueue,
      moveToFront,
      take,
      takeNext,
      updateText,
    }),
    [clear, dismiss, enqueue, items, moveToFront, take, takeNext, updateText],
  )
}

/**
 * Drains parked sends through the normal `generateDeck` path once the current
 * turn is idle. No Backend change: jobs are start/poll/cancel/retry only, so
 * this is flush-on-idle rather than mid-turn steer.
 *
 * Send now / Send all dequeue into `send` after busy clears (immediately when
 * already idle). One queued send starts per idle moment; remaining chips follow
 * in order after that turn ends.
 */
export function useFlushQueuedChatSends(
  queue: UseChatSendQueueResult,
  isBusy: boolean,
  send: (item: ChatSendQueueItem) => Promise<void>,
) {
  const sendingRef = useRef(false)
  const sendRef = useRef(send)
  const [pump, setPump] = useState(0)

  useEffect(() => {
    sendRef.current = send
  }, [send])

  const { items, moveToFront, take, takeNext } = queue

  const dispatch = useCallback(async (item: ChatSendQueueItem) => {
    sendingRef.current = true
    try {
      await sendRef.current(item)
      return true
    } finally {
      sendingRef.current = false
      setPump((value) => value + 1)
    }
  }, [])

  const flushNext = useCallback(async () => {
    if (isBusy || sendingRef.current) {
      return false
    }

    const next = takeNext()
    if (!next) {
      return false
    }

    return dispatch(next)
  }, [dispatch, isBusy, takeNext])

  useEffect(() => {
    if (!isBusy && items.length > 0) {
      void flushNext()
    }
  }, [flushNext, isBusy, items.length, pump])

  const sendNow = useCallback(
    async (id: string) => {
      if (isBusy || sendingRef.current) {
        moveToFront(id)
        return
      }

      const item = take(id)
      if (!item) {
        return
      }

      await dispatch(item)
    },
    [dispatch, isBusy, moveToFront, take],
  )

  const sendAll = useCallback(async () => {
    if (isBusy) {
      return
    }

    await flushNext()
  }, [flushNext, isBusy])

  return { sendNow, sendAll }
}
