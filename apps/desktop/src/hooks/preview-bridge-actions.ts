import type { MutableRefObject, RefObject } from 'react'

import { isDeckHandshakeMessage, type DeckHandshakeMessage } from '@ark/deck-preview/deck-bridge.ts'
import { isAllowedBridgeMessageOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

export type PreviewBridgeSessionPhase = 'idle' | 'awaiting-handshake' | 'armed' | 'compromised'

export type PreviewBridgeCompromiseReason =
  'unexpected-load' | 'missing-handshake' | 'invalid-handshake' | 'handshake-timeout'

export type PreviewBridgeLoadDecision =
  | { action: 'trusted'; allowDownstream: boolean }
  | { action: 'compromised'; allowDownstream: false; reason: PreviewBridgeCompromiseReason }
  | { action: 'ignore'; allowDownstream: false }

export type PreviewSessionSnapshot = {
  key: string
  handshake: string
  phase: PreviewBridgeSessionPhase
  trustedLoadSeen: boolean
  handshakeSeen: boolean
}

export function handlePreviewHandshakeMessage(
  event: MessageEvent,
  args: {
    iframeKey: string
    sandboxOrigin: string | null
    frameRef: RefObject<HTMLIFrameElement | null> | null
    sessionRef: MutableRefObject<PreviewSessionSnapshot>
    compromisedRef: MutableRefObject<boolean>
    markCompromised: (reason: PreviewBridgeCompromiseReason) => void
    tryArm: () => void
  },
) {
  const session = args.sessionRef.current

  if (
    session.key !== args.iframeKey ||
    session.phase === 'compromised' ||
    args.compromisedRef.current
  ) {
    return
  }

  if (!isAllowedBridgeMessageOrigin(event.origin, args.sandboxOrigin)) {
    return
  }

  if (args.frameRef && event.source && event.source !== args.frameRef.current?.contentWindow) {
    return
  }

  if (!isDeckHandshakeMessage(event.data)) {
    return
  }

  const message = event.data as DeckHandshakeMessage

  if (!session.handshake || message.handshake !== session.handshake) {
    args.markCompromised('invalid-handshake')
    return
  }

  session.handshakeSeen = true
  args.tryArm()
}

export function handlePreviewFrameLoad(args: {
  enabled: boolean
  iframeKey: string
  sessionRef: MutableRefObject<PreviewSessionSnapshot>
  compromisedRef: MutableRefObject<boolean>
  setPhase: (phase: PreviewBridgeSessionPhase) => void
  scheduleHandshakeTimeout: () => void
  tryArm: () => void
  markCompromised: (reason: PreviewBridgeCompromiseReason) => void
}): PreviewBridgeLoadDecision {
  if (!args.enabled) {
    return { action: 'ignore', allowDownstream: false }
  }

  const session = args.sessionRef.current

  if (session.key !== args.iframeKey) {
    return { action: 'ignore', allowDownstream: false }
  }

  if (session.phase === 'compromised' || args.compromisedRef.current) {
    return { action: 'compromised', allowDownstream: false, reason: 'unexpected-load' }
  }

  if (!session.trustedLoadSeen) {
    session.trustedLoadSeen = true

    if (session.phase !== 'armed') {
      session.phase = 'awaiting-handshake'
      args.setPhase('awaiting-handshake')
    }

    args.scheduleHandshakeTimeout()
    args.tryArm()

    const allowDownstream = session.phase === 'armed' && !args.compromisedRef.current
    return { action: 'trusted', allowDownstream }
  }

  args.compromisedRef.current = true
  args.markCompromised('unexpected-load')
  return { action: 'compromised', allowDownstream: false, reason: 'unexpected-load' }
}
