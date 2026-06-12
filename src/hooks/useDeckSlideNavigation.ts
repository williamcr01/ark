import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '@/lib/deck-preview'

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

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

export function useDeckSlideNavigation(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  slideCount: number,
  html: string,
  enabled: boolean,
) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [prevHtml, setPrevHtml] = useState(html)
  const activeSlideIndexRef = useRef(activeSlideIndex)

  if (prevHtml !== html) {
    setPrevHtml(html)
    setActiveSlideIndex(0)
  }

  useEffect(() => {
    activeSlideIndexRef.current = activeSlideIndex
  }, [activeSlideIndex])

  const goToSlide = useCallback(
    (index: number) => {
      if (index < 0 || index >= slideCount) {
        return
      }

      setActiveSlideIndex(index)
      activeSlideIndexRef.current = index

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return
      }

      iframeWindow.postMessage({ type: DECK_GOTO_MESSAGE_TYPE, index }, '*')
    },
    [iframeRef, slideCount],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      const data = event.data as { type?: string; index?: number } | null

      if (
        data?.type === DECK_SLIDE_CHANGE_MESSAGE_TYPE &&
        typeof data.index === 'number'
      ) {
        setActiveSlideIndex(data.index)
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [enabled, iframeRef])

  useEffect(() => {
    if (!enabled || slideCount === 0) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!NAV_KEYS.has(event.key) || isTypingTarget(event.target)) {
        return
      }

      event.preventDefault()

      const delta =
        event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
      const nextIndex = Math.max(
        0,
        Math.min(slideCount - 1, activeSlideIndexRef.current + delta),
      )

      if (nextIndex !== activeSlideIndexRef.current) {
        goToSlide(nextIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, goToSlide, slideCount])

  useEffect(() => {
    if (!enabled || slideCount === 0) {
      return
    }

    const iframe = iframeRef.current

    if (!iframe) {
      return
    }

    const handleLoad = () => {
      goToSlide(activeSlideIndexRef.current)
    }

    iframe.addEventListener('load', handleLoad)

    return () => {
      iframe.removeEventListener('load', handleLoad)
    }
  }, [enabled, goToSlide, html, iframeRef, slideCount])

  return { activeSlideIndex, goToSlide }
}
