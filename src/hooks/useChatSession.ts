import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatMessage } from '../../shared/chat.ts'
import { persistedMessageToChatMessage } from '../../shared/chat-thread.ts'
import { appendDeckChatMessage, clearDeckChat, fetchAllDeckChat } from '@/lib/chat-api'
import {
  clearChatSession,
  createChatSession,
  readChatSession,
  writeChatSession,
} from '@/lib/chat-session'

export type UseChatSessionOptions = {
  deckId: string | null
  deckVersionId?: string | null
}

export function useChatSession({ deckId, deckVersionId = null }: UseChatSessionOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => readChatSession(deckId)?.messages ?? createChatSession().messages,
  )
  const [isLoading, setIsLoading] = useState(Boolean(deckId))
  const loadRequestIdRef = useRef(0)
  const deckIdRef = useRef(deckId)

  useEffect(() => {
    deckIdRef.current = deckId
  }, [deckId])

  useEffect(() => {
    const requestId = ++loadRequestIdRef.current

    void (async () => {
      setIsLoading(Boolean(deckId))

      if (!deckId) {
        const localMessages = readChatSession(null)?.messages ?? []

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setMessages(localMessages)
        setIsLoading(false)
        return
      }

      try {
        const data = await fetchAllDeckChat(deckId)
        const nextMessages = data.messages.map(persistedMessageToChatMessage)

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setMessages(nextMessages)
        writeChatSession(deckId, {
          messages: nextMessages,
          updatedAt: new Date().toISOString(),
        })
      } catch {
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setMessages(readChatSession(deckId)?.messages ?? [])
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    })()
  }, [deckId])

  useEffect(() => {
    writeChatSession(deckId, {
      messages,
      updatedAt: new Date().toISOString(),
    })
  }, [deckId, messages])

  const persistMessage = useCallback(
    async (message: ChatMessage) => {
      if (!deckIdRef.current) {
        return
      }

      try {
        await appendDeckChatMessage(deckIdRef.current, {
          id: message.id,
          role: message.role,
          content: message.content,
          parts: message.parts,
          attachments: message.attachments,
          deckVersionId,
        })
      } catch {
        // Keep local cache even when the API is unavailable.
      }
    },
    [deckVersionId],
  )

  const appendMessage = useCallback(
    async (message: ChatMessage) => {
      setMessages((current) => [...current, message])
      await persistMessage(message)
    },
    [persistMessage],
  )

  const reloadChat = useCallback(async (targetDeckId?: string | null) => {
    const activeDeckId = targetDeckId ?? deckIdRef.current

    if (!activeDeckId) {
      return readChatSession(null)?.messages ?? []
    }

    try {
      const data = await fetchAllDeckChat(activeDeckId)
      const nextMessages = data.messages.map(persistedMessageToChatMessage)
      setMessages(nextMessages)
      writeChatSession(activeDeckId, {
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
      })
      return nextMessages
    } catch {
      return readChatSession(activeDeckId)?.messages ?? []
    }
  }, [])

  const resetChat = useCallback(async () => {
    const activeDeckId = deckIdRef.current

    clearChatSession(activeDeckId)
    setMessages([])

    if (!activeDeckId) {
      return
    }

    try {
      await clearDeckChat(activeDeckId)
    } catch {
      // Local state is already cleared.
    }
  }, [])

  return {
    appendMessage,
    isLoading,
    messages,
    persistMessage,
    reloadChat,
    resetChat,
    setMessages,
  }
}
