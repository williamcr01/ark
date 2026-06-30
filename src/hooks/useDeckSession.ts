import { useCallback, useEffect, useState } from 'react'

import type { ChatMessage } from '../../shared/chat.ts'
import {
  clearDeckSession,
  createDeckSession,
  readDeckSession,
  writeDeckSession,
} from '@/lib/deck-session'

const loadInitialSession = () => readDeckSession() ?? createDeckSession()

export function useDeckSession() {
  const [initialSession] = useState(loadInitialSession)
  const [sessionId, setSessionId] = useState(initialSession.id)
  const [html, setHtml] = useState(initialSession.html)
  const [messages, setMessages] = useState<ChatMessage[]>(initialSession.messages)

  useEffect(() => {
    writeDeckSession({
      id: sessionId,
      html,
      messages,
      updatedAt: new Date().toISOString(),
    })
  }, [sessionId, html, messages])

  const resetSession = useCallback(() => {
    const nextSession = createDeckSession()
    clearDeckSession()
    writeDeckSession(nextSession)
    setSessionId(nextSession.id)
    setHtml('')
    setMessages([])
  }, [])

  return {
    html,
    messages,
    resetSession,
    sessionId,
    setHtml,
    setMessages,
  }
}
