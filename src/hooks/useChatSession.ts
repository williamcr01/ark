import { useCallback, useEffect, useState } from 'react'

import type { ChatMessage } from '../../shared/chat.ts'
import {
  clearChatSession,
  createChatSession,
  readChatSession,
  writeChatSession,
} from '@/lib/chat-session'

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => readChatSession()?.messages ?? createChatSession().messages,
  )

  useEffect(() => {
    writeChatSession({
      messages,
      updatedAt: new Date().toISOString(),
    })
  }, [messages])

  const resetChat = useCallback(() => {
    clearChatSession()
    setMessages([])
  }, [])

  return {
    messages,
    resetChat,
    setMessages,
  }
}
