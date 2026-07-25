import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { isDeckHandshakeMessage, type DeckHandshakeMessage } from '@ark/deck-core/deck-bridge.ts'
import { isAllowedBridgeMessageOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

export type PreviewBridgeSessionPhase = 'idle' | 'awaiting-handshake' | 'armed' | 'compromised'

export type PreviewBridgeSessionOptions = {
  /** When false, the session stays idle and never arms. */
  enabled?: boolean
  /**
   * Expected handshake value for this iframe generation.
   * Empty/null keeps the session awaiting until timeout (then compromised).
   */
  handshake?: string | null
  sandboxOrigin?: string | null
  /** Bounded wait for handshake after a trusted load (ms). */
  handshakeTimeoutMs?: number
  onCompromised?: (reason: PreviewBridgeCompromiseReason) => void
}

export type PreviewBridgeCompromiseReason =
  'unexpected-load' | 'missing-handshake' | 'invalid-handshake' | 'handshake-timeout'

export type PreviewBridgeLoadDecision =
  | { action: 'trusted'; allowDownstream: boolean }
  | { action: 'compromised'; allowDownstream: false; reason: PreviewBridgeCompromiseReason }
  | { action: 'ignore'; allowDownstream: false }

export type PreviewBridgeSessionResult = {
  phase: PreviewBridgeSessionPhase
  /** React state for UI (banner). Prefer canPostToFrame / compromisedRef for send gates. */
  compromised: boolean
  /** Why the session entered compromised; null while healthy. */
  compromiseReason: PreviewBridgeCompromiseReason | null
  armed: boolean
  /** Synchronous send gate — true only while phase is armed. */
  canPostToFrame: () => boolean
  /** Imperative compromised flag; flipped synchronously in onFrameLoad. */
  compromisedRef: RefObject<boolean>
  /**
   * Single load entry point. Call before any enableEditor / slide sync.
   * Flips compromisedRef synchronously on unexpected loads.
   */
  onFrameLoad: () => PreviewBridgeLoadDecision
  /** Whether ordinary bridge/editor inbound messages should be processed. */
  shouldAcceptInbound: () => boolean
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000

type SessionSnapshot = {
  key: string
  handshake: string
  phase: PreviewBridgeSessionPhase
  trustedLoadSeen: boolean
  handshakeSeen: boolean
}

function initialPhase(enabled: boolean, iframeKey: string): PreviewBridgeSessionPhase {
  return enabled && iframeKey ? 'awaiting-handshake' : 'idle'
}

/**
 * Ref-gated preview bridge session.
 *
 * Phases:
 * - idle: no active generation
 * - awaiting-handshake: generation started; no parent→frame commands yet
 * - armed: expected handshake + trusted load completed; bridge traffic allowed
 * - compromised: unexpected load / missing handshake; send gate closed
 *
 * React `compromised` state is display-only. Outbound posts must use
 * `canPostToFrame()` so a hostile load cannot race state commits.
 *
 * Editor commands use their own authenticated per-generation MessagePort.
 * Navigation remains on this ref-gated window channel.
 */
export function usePreviewBridgeSession(
  iframeKey: string,
  options: PreviewBridgeSessionOptions = {},
): PreviewBridgeSessionResult {
  const enabled = options.enabled ?? true
  const handshake = options.handshake?.trim() ?? ''
  const sandboxOrigin = options.sandboxOrigin ?? null
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  const onCompromised = options.onCompromised

  const [phase, setPhase] = useState<PreviewBridgeSessionPhase>(() =>
    initialPhase(enabled, iframeKey),
  )
  const [compromiseReason, setCompromiseReason] = useState<PreviewBridgeCompromiseReason | null>(
    null,
  )
  const [sessionIdentity, setSessionIdentity] = useState({
    key: iframeKey,
    enabled,
    handshake,
  })

  // Adjust React state when the shell remounts the iframe or toggles the session.
  if (sessionIdentity.key !== iframeKey || sessionIdentity.enabled !== enabled) {
    setSessionIdentity({ key: iframeKey, enabled, handshake })
    setPhase(initialPhase(enabled, iframeKey))
    setCompromiseReason(null)
  } else if (sessionIdentity.handshake !== handshake && phase !== 'compromised') {
    setSessionIdentity({ key: iframeKey, enabled, handshake })
  }

  const activeKey =
    sessionIdentity.key === iframeKey && sessionIdentity.enabled === enabled ? iframeKey : iframeKey
  const activeHandshake =
    sessionIdentity.key === iframeKey &&
    sessionIdentity.enabled === enabled &&
    (sessionIdentity.handshake === handshake || phase === 'compromised')
      ? sessionIdentity.handshake
      : handshake
  const activeEnabled =
    sessionIdentity.key === iframeKey && sessionIdentity.enabled === enabled
      ? sessionIdentity.enabled
      : enabled
  const activePhase =
    sessionIdentity.key === iframeKey && sessionIdentity.enabled === enabled
      ? phase
      : initialPhase(enabled, iframeKey)

  const sessionRef = useRef<SessionSnapshot>({
    key: activeKey,
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

  // Keep the imperative snapshot aligned with the active generation before paint
  // so an early handshake cannot see a stale key from the previous iframe.
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
      phase: initialPhase(enabled, iframeKey),
      trustedLoadSeen: false,
      handshakeSeen: false,
    }
  }, [enabled, iframeKey]) // eslint-disable-line react-hooks/exhaustive-deps -- handshake updates via mirror effect

  // Mirror display phase / handshake into the imperative snapshot without resetting load flags.
  useLayoutEffect(() => {
    sessionRef.current.phase = phase
    sessionRef.current.handshake = handshake
    sessionRef.current.key = iframeKey
  }, [handshake, iframeKey, phase])

  const clearHandshakeTimeout = useCallback(() => {
    if (handshakeTimeoutRef.current !== null) {
      window.clearTimeout(handshakeTimeoutRef.current)
      handshakeTimeoutRef.current = null
    }
  }, [])

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
    [clearHandshakeTimeout],
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
  }, [clearHandshakeTimeout])

  // Attach before paint so a fast iframe handshake is not dropped between
  // commit and the passive useEffect flush (Present mode remounts hit this).
  useLayoutEffect(() => {
    if (!enabled || !iframeKey) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      const session = sessionRef.current

      if (session.key !== iframeKey || session.phase === 'compromised' || compromisedRef.current) {
        return
      }

      if (!isAllowedBridgeMessageOrigin(event.origin, sandboxOrigin)) {
        return
      }

      if (!isDeckHandshakeMessage(event.data)) {
        return
      }

      const message = event.data as DeckHandshakeMessage

      if (!session.handshake || message.handshake !== session.handshake) {
        markCompromised('invalid-handshake')
        return
      }

      // Idempotent: sentinel may retry the same handshake several times.
      session.handshakeSeen = true
      tryArm()
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [enabled, iframeKey, markCompromised, sandboxOrigin, tryArm])

  useEffect(() => {
    return () => {
      clearHandshakeTimeout()
    }
  }, [clearHandshakeTimeout])

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
  }, [clearHandshakeTimeout, handshakeTimeoutMs, markCompromised])

  const onFrameLoad = useCallback((): PreviewBridgeLoadDecision => {
    if (!enabled) {
      return { action: 'ignore', allowDownstream: false }
    }

    const session = sessionRef.current

    if (session.key !== iframeKey) {
      return { action: 'ignore', allowDownstream: false }
    }

    if (session.phase === 'compromised' || compromisedRef.current) {
      return { action: 'compromised', allowDownstream: false, reason: 'unexpected-load' }
    }

    // First load for this generation: start handshake wait. Do NOT treat load
    // alone as trusted for outbound posts — arm only after handshake too.
    if (!session.trustedLoadSeen) {
      session.trustedLoadSeen = true

      if (session.phase !== 'armed') {
        session.phase = 'awaiting-handshake'
        setPhase('awaiting-handshake')
      }

      scheduleHandshakeTimeout()
      tryArm()

      // Allow downstream only when already armed (handshake arrived before load).
      const allowDownstream = session.phase === 'armed' && !compromisedRef.current
      return { action: 'trusted', allowDownstream }
    }

    // Second+ load on the same generation = self-navigation.
    compromisedRef.current = true
    markCompromised('unexpected-load')
    return { action: 'compromised', allowDownstream: false, reason: 'unexpected-load' }
  }, [enabled, iframeKey, markCompromised, scheduleHandshakeTimeout, tryArm])

  const canPostToFrame = useCallback(() => {
    return (
      enabled &&
      !compromisedRef.current &&
      sessionRef.current.phase === 'armed' &&
      sessionRef.current.key === iframeKey
    )
  }, [enabled, iframeKey])

  const shouldAcceptInbound = useCallback(() => {
    return canPostToFrame()
  }, [canPostToFrame])

  return {
    phase: activePhase,
    compromised: activeEnabled && activePhase === 'compromised',
    compromiseReason: activeEnabled && activePhase === 'compromised' ? compromiseReason : null,
    armed: activeEnabled && activePhase === 'armed',
    canPostToFrame,
    compromisedRef,
    onFrameLoad,
    shouldAcceptInbound,
  }
}
