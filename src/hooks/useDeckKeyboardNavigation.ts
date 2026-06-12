import { useEffect, type RefObject } from 'react'

import { DECK_KEYDOWN_MESSAGE_TYPE } from '@/lib/deck-preview'

const DECK_NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
])

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tag = target.tagName

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }

  return Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
}

function isIframeVisible(iframe: HTMLIFrameElement) {
  const { width, height } = iframe.getBoundingClientRect()

  return width > 0 && height > 0
}

export function useDeckKeyboardNavigation(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!DECK_NAV_KEYS.has(event.key) || isTypingTarget(event.target)) {
        return
      }

      const iframe = iframeRef.current
      const iframeWindow = iframe?.contentWindow

      if (!iframe || !iframeWindow || !isIframeVisible(iframe)) {
        return
      }

      event.preventDefault()

      iframeWindow.postMessage(
        {
          type: DECK_KEYDOWN_MESSAGE_TYPE,
          key: event.key,
          code: event.code,
        },
        '*',
      )
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, iframeRef])
}
