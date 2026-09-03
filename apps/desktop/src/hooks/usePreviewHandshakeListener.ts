import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react'

import {
  handlePreviewHandshakeMessage,
  type PreviewBridgeCompromiseReason,
  type PreviewSessionSnapshot,
} from './preview-bridge-actions.ts'

export function usePreviewHandshakeListener(args: {
  enabled: boolean
  iframeKey: string
  frameRef: RefObject<HTMLIFrameElement | null> | null
  sandboxOrigin: string | null
  sessionRef: MutableRefObject<PreviewSessionSnapshot>
  compromisedRef: MutableRefObject<boolean>
  markCompromised: (reason: PreviewBridgeCompromiseReason) => void
  tryArm: () => void
}) {
  const {
    enabled,
    iframeKey,
    frameRef,
    sandboxOrigin,
    sessionRef,
    compromisedRef,
    markCompromised,
    tryArm,
  } = args

  useLayoutEffect(() => {
    if (!enabled || !iframeKey) {
      return
    }
    const handleMessage = (event: MessageEvent) => {
      handlePreviewHandshakeMessage(event, {
        iframeKey,
        sandboxOrigin,
        frameRef,
        sessionRef,
        compromisedRef,
        markCompromised,
        tryArm,
      })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [
    compromisedRef,
    enabled,
    frameRef,
    iframeKey,
    markCompromised,
    sandboxOrigin,
    sessionRef,
    tryArm,
  ])
}
