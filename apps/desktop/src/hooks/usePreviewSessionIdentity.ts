import { useState } from 'react'

import type {
  PreviewBridgeCompromiseReason,
  PreviewBridgeSessionPhase,
} from './preview-bridge-actions.ts'

function initialPhase(enabled: boolean, iframeKey: string): PreviewBridgeSessionPhase {
  return enabled && iframeKey ? 'awaiting-handshake' : 'idle'
}

export function usePreviewSessionIdentity(iframeKey: string, enabled: boolean, handshake: string) {
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

  if (sessionIdentity.key !== iframeKey || sessionIdentity.enabled !== enabled) {
    setSessionIdentity({ key: iframeKey, enabled, handshake })
    setPhase(initialPhase(enabled, iframeKey))
    setCompromiseReason(null)
  } else if (sessionIdentity.handshake !== handshake && phase !== 'compromised') {
    setSessionIdentity({ key: iframeKey, enabled, handshake })
  }

  const identityMatches = sessionIdentity.key === iframeKey && sessionIdentity.enabled === enabled
  const activeHandshake =
    identityMatches && (sessionIdentity.handshake === handshake || phase === 'compromised')
      ? sessionIdentity.handshake
      : handshake
  const activeEnabled = identityMatches ? sessionIdentity.enabled : enabled
  const activePhase = identityMatches ? phase : initialPhase(enabled, iframeKey)

  return {
    phase,
    setPhase,
    compromiseReason,
    setCompromiseReason,
    activeHandshake,
    activeEnabled,
    activePhase,
    initialPhase,
  }
}
