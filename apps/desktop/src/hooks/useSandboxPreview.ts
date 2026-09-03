import { useEffect, useRef, useState } from 'react'

import { resolveAppOrigin, resolveSandboxOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

import { EMPTY_PREVIEW_SESSION, type PreviewSessionSnapshot } from './sandbox-preview-session.ts'
import { runSandboxPreviewEffect } from './sandbox-preview-effect.ts'

export type SandboxPreviewState = {
  previewUrl: string | null
  sandboxOrigin: string
  appOrigin: string
  isLoading: boolean
  /** True when previewUrl still points at an older successful session for the latest HTML. */
  isStale: boolean
  error: string | null
  sessionToken: string | null
  handshake: string | null
}

export function useSandboxPreview(
  html: string,
  enabled: boolean,
  reloadRevision = 0,
  deckId?: string | null,
): SandboxPreviewState {
  const sandboxOrigin = resolveSandboxOrigin()
  const appOrigin = resolveAppOrigin()
  const shouldLoad = enabled && html.trim().length > 0
  const [previewSession, setPreviewSession] =
    useState<PreviewSessionSnapshot>(EMPTY_PREVIEW_SESSION)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const activeRequestRef = useRef<{
    requestId: number
    controller: AbortController
  } | null>(null)
  const pendingTimerRef = useRef<number | null>(null)
  const observedHtmlRef = useRef<string | null>(null)
  const lastHtmlChangeAtRef = useRef<number | null>(null)
  const previewSessionRef = useRef(previewSession)

  useEffect(() => {
    previewSessionRef.current = previewSession
  }, [previewSession])

  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect -- one-shot preview-session fetch with AbortController + request-id staleness guards; project has no data-fetching library (rule's documented suppression)
  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect -- post-await setters are guarded by requestIdRef/abort checks so stale effect runs are ignored before any state write
  useEffect(() => {
    return runSandboxPreviewEffect({
      html,
      reloadRevision,
      shouldLoad,
      deckId,
      sandboxOrigin,
      appOrigin,
      refs: {
        requestIdRef,
        activeRequestRef,
        pendingTimerRef,
        observedHtmlRef,
        lastHtmlChangeAtRef,
        previewSessionRef,
      },
      setIsLoading,
      setError,
      setPreviewSession,
    })
  }, [appOrigin, deckId, html, reloadRevision, sandboxOrigin, shouldLoad])

  if (!shouldLoad) {
    return {
      previewUrl: null,
      sandboxOrigin,
      appOrigin,
      isLoading: false,
      isStale: false,
      error: null,
      sessionToken: null,
      handshake: null,
    }
  }

  const isStale =
    previewSession.previewUrl !== null &&
    (previewSession.html !== html || previewSession.reloadRevision !== reloadRevision)

  return {
    previewUrl: previewSession.previewUrl,
    sandboxOrigin: previewSession.sandboxOrigin ?? sandboxOrigin,
    appOrigin,
    isLoading,
    isStale,
    error,
    sessionToken: previewSession.sessionToken,
    handshake: previewSession.handshake,
  }
}

/**
 * Cheap content fingerprint so equal-length HTML edits remount the iframe.
 * Not cryptographic — only needs to change when preview HTML changes.
 */
export function fingerprintPreviewHtml(html: string): string {
  let hash = 2166136261

  for (let index = 0; index < html.length; index += 1) {
    hash ^= html.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  hash ^= html.length
  return (hash >>> 0).toString(36)
}
