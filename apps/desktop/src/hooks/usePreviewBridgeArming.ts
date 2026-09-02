import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react'

import type {
  PreviewBridgeCompromiseReason,
  PreviewBridgeSessionPhase,
  PreviewSessionSnapshot,
} from './preview-bridge-actions.ts'
import { usePreviewHandshakeListener } from './usePreviewHandshakeListener.ts'

export function usePreviewBridgeArming(args: {
  enabled: boolean
  iframeKey: string
  frameRef: RefObject<HTMLIFrameElement | null> | null
  sandboxOrigin: string | null
  handshakeTimeoutMs: number
  sessionRef: MutableRefObject<PreviewSessionSnapshot>
  compromisedRef: MutableRefObject<boolean>
  reportedCompromiseRef: MutableRefObject<boolean>
  handshakeTimeoutRef: MutableRefObject<number | null>
  onCompromisedRef: MutableRefObject<((reason: PreviewBridgeCompromiseReason) => void) | undefined>
  generationEpochRef: MutableRefObject<number>
  setPhase: (phase: PreviewBridgeSessionPhase) => void
  setCompromiseReason: (reason: PreviewBridgeCompromiseReason | null) => void
}) {
  const {
    sessionRef,
    compromisedRef,
    reportedCompromiseRef,
    handshakeTimeoutRef,
    onCompromisedRef,
    generationEpochRef,
    setPhase,
    setCompromiseReason,
    handshakeTimeoutMs,
    enabled,
    iframeKey,
    frameRef,
    sandboxOrigin,
  } = args

  const clearHandshakeTimeout = useCallback(() => {
    if (handshakeTimeoutRef.current !== null) {
      window.clearTimeout(handshakeTimeoutRef.current)
      handshakeTimeoutRef.current = null
    }
  }, [handshakeTimeoutRef])

  const markCompromised = useCallback(
    (reason: PreviewBridgeCompromiseReason) => {
      const session = sessionRef.current
      if (session.phase === 'compromised' && compromisedRef.current) {
        return
      }
      compromisedRef.current = true
      clearHandshakeTimeout()
      session.phase = 'compromised'
      setPhase('compromised')
      setCompromiseReason(reason)
      if (!reportedCompromiseRef.current) {
        reportedCompromiseRef.current = true
        onCompromisedRef.current?.(reason)
      }
    },
    [
      clearHandshakeTimeout,
      compromisedRef,
      onCompromisedRef,
      reportedCompromiseRef,
      sessionRef,
      setCompromiseReason,
      setPhase,
    ],
  )

  const tryArm = useCallback(() => {
    const session = sessionRef.current
    if (session.phase === 'compromised' || compromisedRef.current) {
      return
    }
    if (!session.trustedLoadSeen || !session.handshakeSeen) {
      return
    }
    clearHandshakeTimeout()
    session.phase = 'armed'
    setPhase('armed')
  }, [clearHandshakeTimeout, compromisedRef, sessionRef, setPhase])

  usePreviewHandshakeListener({
    enabled,
    iframeKey,
    frameRef,
    sandboxOrigin,
    sessionRef,
    compromisedRef,
    markCompromised,
    tryArm,
  })

  useEffect(() => () => clearHandshakeTimeout(), [clearHandshakeTimeout])

  const scheduleHandshakeTimeout = useCallback(() => {
    clearHandshakeTimeout()
    const epoch = generationEpochRef.current
    handshakeTimeoutRef.current = window.setTimeout(() => {
      if (epoch !== generationEpochRef.current) {
        return
      }
      const session = sessionRef.current
      if (session.phase === 'armed' || session.phase === 'compromised') {
        return
      }
      markCompromised(session.handshakeSeen ? 'missing-handshake' : 'handshake-timeout')
    }, handshakeTimeoutMs)
  }, [
    clearHandshakeTimeout,
    generationEpochRef,
    handshakeTimeoutMs,
    handshakeTimeoutRef,
    markCompromised,
    sessionRef,
  ])

  return { markCompromised, tryArm, scheduleHandshakeTimeout }
}
