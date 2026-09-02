import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { QueuedChatSend } from '@/lib/chat/chat-send-queue'
import { newId } from '@/lib/ui/id'

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
  const [items, setItems] = useState<ChatSendQueueItem[]>([])
  const itemsRef = useRef<ChatSendQueueItem[]>([])

  const enqueue = useCallback((item: Omit<ChatSendQueueItem, 'id'> & { id?: string }) => {
    const queued: ChatSendQueueItem = {
      ...item,
      id: item.id ?? newId(),
    }
    itemsRef.current = [...itemsRef.current, queued]
    setItems(itemsRef.current)
    return queued
  }, [])

  const dismiss = useCallback((id: string) => {
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id)
    setItems(itemsRef.current)
  }, [])

  const updateText = useCallback((id: string, text: string) => {
    itemsRef.current = itemsRef.current.map((item) => (item.id === id ? { ...item, text } : item))
    setItems(itemsRef.current)
  }, [])

  const moveToFront = useCallback((id: string) => {
    const index = itemsRef.current.findIndex((item) => item.id === id)
    if (index <= 0) {
      return
    }

    const next = [...itemsRef.current]
    const [item] = next.splice(index, 1)
    itemsRef.current = [item, ...next]
    setItems(itemsRef.current)
  }, [])

  const take = useCallback((id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id) ?? null
    if (!item) {
      return null
    }

    itemsRef.current = itemsRef.current.filter((entry) => entry.id !== id)
    setItems(itemsRef.current)
    return item
  }, [])

  const takeNext = useCallback(() => {
    const item = itemsRef.current[0]
    if (!item) {
      return null
    }

    itemsRef.current = itemsRef.current.slice(1)
    setItems(itemsRef.current)
    return item
  }, [])

  const clear = useCallback(() => {
    itemsRef.current = []
    setItems(itemsRef.current)
  }, [])

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
 * Drains parked sends as sequential generation turns. Jobs have no steer
 * endpoint, so a busy run cannot accept a mid-turn follow-up — `sendNow`
 * while busy only reorders so that chip is first once the current turn ends.
 *
 * One queued send starts per idle moment. After that turn finishes, this hook
 * starts the next item so follow-ups land in order.
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

  const { items, moveToFront, takeNext } = queue

  const flushNext = useCallback(async () => {
    if (isBusy || sendingRef.current) {
      return false
    }

    const next = takeNext()
    if (!next) {
      return false
    }

    sendingRef.current = true
    try {
      await sendRef.current(next)
      return true
    } finally {
      sendingRef.current = false
      setPump((value) => value + 1)
    }
  }, [isBusy, takeNext])

  useEffect(() => {
    if (!isBusy && items.length > 0) {
      void flushNext()
    }
  }, [flushNext, isBusy, items.length, pump])

  const sendNow = useCallback(
    async (id: string) => {
      moveToFront(id)
      if (isBusy) {
        return
      }

      await flushNext()
    },
    [flushNext, isBusy, moveToFront],
  )

  const sendAll = useCallback(async () => {
    if (isBusy) {
      return
    }

    await flushNext()
  }, [flushNext, isBusy])

  return { sendNow, sendAll }
}
