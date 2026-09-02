import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import {
  handlePreviewFrameLoad,
  type PreviewBridgeCompromiseReason,
  type PreviewBridgeLoadDecision,
  type PreviewBridgeSessionPhase,
  type PreviewSessionSnapshot,
} from './preview-bridge-actions.ts'
import { usePreviewBridgeArming } from './usePreviewBridgeArming.ts'
import { usePreviewSessionIdentity } from './usePreviewSessionIdentity.ts'

export type { PreviewBridgeCompromiseReason, PreviewBridgeLoadDecision, PreviewBridgeSessionPhase }

export type PreviewBridgeSessionOptions = {
  enabled?: boolean
  handshake?: string | null
  frameRef?: RefObject<HTMLIFrameElement | null>
  sandboxOrigin?: string | null
  handshakeTimeoutMs?: number
  onCompromised?: (reason: PreviewBridgeCompromiseReason) => void
}

export type PreviewBridgeSessionResult = {
  phase: PreviewBridgeSessionPhase
  compromised: boolean
  compromiseReason: PreviewBridgeCompromiseReason | null
  armed: boolean
  canPostToFrame: () => boolean
  compromisedRef: RefObject<boolean>
  onFrameLoad: () => PreviewBridgeLoadDecision
  shouldAcceptInbound: () => boolean
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000

export function usePreviewBridgeSession(
  iframeKey: string,
  options: PreviewBridgeSessionOptions = {},
): PreviewBridgeSessionResult {
  const enabled = options.enabled ?? true
  const handshake = options.handshake?.trim() ?? ''
  const frameRef = options.frameRef ?? null
  const sandboxOrigin = options.sandboxOrigin ?? null
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  const onCompromised = options.onCompromised
  const identity = usePreviewSessionIdentity(iframeKey, enabled, handshake)
  const { setPhase, setCompromiseReason, activeHandshake, activeEnabled, activePhase } = identity

  const sessionRef = useRef<PreviewSessionSnapshot>({
    key: iframeKey,
    handshake: activeHandshake,
    phase: activePhase,
    trustedLoadSeen: false,
    handshakeSeen: false,
  })
  const compromisedRef = useRef(false)
  const reportedCompromiseRef = useRef(false)
  const handshakeTimeoutRef = useRef<number | null>(null)
  const onCompromisedRef = useRef(onCompromised)
  const generationEpochRef = useRef(0)

  useEffect(() => {
    onCompromisedRef.current = onCompromised
  }, [onCompromised])

  useLayoutEffect(() => {
    if (handshakeTimeoutRef.current !== null) {
      window.clearTimeout(handshakeTimeoutRef.current)
      handshakeTimeoutRef.current = null
    }
    generationEpochRef.current += 1
    reportedCompromiseRef.current = false
    compromisedRef.current = false
    sessionRef.current = {
      key: iframeKey,
      handshake,
      phase: identity.initialPhase(enabled, iframeKey),
      trustedLoadSeen: false,
      handshakeSeen: false,
    }
  }, [enabled, iframeKey]) // eslint-disable-line react-hooks/exhaustive-deps -- handshake updates via mirror effect

  useLayoutEffect(() => {
    sessionRef.current.phase = identity.phase
    sessionRef.current.handshake = handshake
    sessionRef.current.key = iframeKey
  }, [handshake, identity.phase, iframeKey])

  const { markCompromised, tryArm, scheduleHandshakeTimeout } = usePreviewBridgeArming({
    enabled,
    iframeKey,
    frameRef,
    sandboxOrigin,
    handshakeTimeoutMs,
    sessionRef,
    compromisedRef,
    reportedCompromiseRef,
    handshakeTimeoutRef,
    onCompromisedRef,
    generationEpochRef,
    setPhase,
    setCompromiseReason,
  })

  const onFrameLoad = useCallback(
    (): PreviewBridgeLoadDecision =>
      handlePreviewFrameLoad({
        enabled,
        iframeKey,
        sessionRef,
        compromisedRef,
        setPhase,
        scheduleHandshakeTimeout,
        tryArm,
        markCompromised,
      }),
    [enabled, iframeKey, markCompromised, scheduleHandshakeTimeout, setPhase, tryArm],
  )

  const canPostToFrame = useCallback(() => {
    return (
      enabled &&
      !compromisedRef.current &&
      sessionRef.current.phase === 'armed' &&
      sessionRef.current.key === iframeKey
    )
  }, [enabled, iframeKey])

  const shouldAcceptInbound = useCallback(() => canPostToFrame(), [canPostToFrame])

  return {
    phase: activePhase,
    compromised: activeEnabled && activePhase === 'compromised',
    compromiseReason:
      activeEnabled && activePhase === 'compromised' ? identity.compromiseReason : null,
    armed: activeEnabled && activePhase === 'armed',
    canPostToFrame,
    compromisedRef,
    onFrameLoad,
    shouldAcceptInbound,
  }
}
