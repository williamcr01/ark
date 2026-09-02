import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import {
  getChatPanelDefaultSize,
  getDeckPanelDefaultSizeWithChat,
} from '@/lib/chat/chat-panel-layout'
import { loadChatOpenPreference, storeChatOpenPreference } from '@/lib/ui/app-shell-preferences'
import { useShellStore } from '@/state/shell-store.ts'

import { useElementSize } from './useElementSize'
import { useMediaQuery } from './useMediaQuery'

export function useChatPanelLayout(shortcutEnabled = true) {
  const isDesktopQuery = useMediaQuery('(min-width: 1180px)')
  useState(() => {
    useShellStore.getState().syncFromDesktopSettings()
    useShellStore.getState().setDesktop(isDesktopQuery)
    useShellStore.getState().setChatOpen(loadChatOpenPreference() ?? isDesktopQuery)
    return true
  })
  const isDesktop = useShellStore((state) => state.isDesktop)
  const isChatOpen = useShellStore((state) => state.isChatOpen)
  if (isDesktop !== isDesktopQuery) {
    const wasDesktop = isDesktop
    useShellStore.getState().setDesktop(isDesktopQuery)
    if (wasDesktop && !isDesktopQuery && isChatOpen) {
      useShellStore.getState().setChatOpen(false)
    }
  }

  const handleToggleChat = useCallback(() => {
    const next = !useShellStore.getState().isChatOpen
    useShellStore.getState().setChatOpen(next)
    storeChatOpenPreference(next)
  }, [])

  const handleChatOpenChange = useCallback((open: boolean) => {
    if (open === useShellStore.getState().isChatOpen) {
      return
    }
    useShellStore.getState().setChatOpen(open)
    storeChatOpenPreference(open)
  }, [])

  const handleChatShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!shortcutEnabled) {
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
      return
    }
    if (event.key.toLowerCase() !== 'b') {
      return
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    ) {
      return
    }
    event.preventDefault()
    handleToggleChat()
  })

  useEffect(() => {
    window.addEventListener('keydown', handleChatShortcut)
    return () => window.removeEventListener('keydown', handleChatShortcut)
  }, [])

  const [mainRef, mainSize] = useElementSize<HTMLElement>()
  const chatDefaultSize = getChatPanelDefaultSize(mainSize.width)
  const deckDefaultSizeWithChat = getDeckPanelDefaultSizeWithChat(mainSize.width, chatDefaultSize)

  return {
    isDesktop,
    isChatOpen,
    handleToggleChat,
    handleChatOpenChange,
    chatDefaultSize,
    deckDefaultSizeWithChat,
    mainRef,
  }
}
