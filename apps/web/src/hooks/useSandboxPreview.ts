import { useEffect, useMemo, useRef, useState } from 'react'

import { previewSessionResponseSchema, fetchApiJsonOrThrow } from '@ark/contracts'
import {
  buildSandboxRenderUrl,
  resolveAppOrigin,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

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

const PREVIEW_SESSION_COALESCE_MS = 100
/** Interactive shell previews always inject a dormant editor runtime. */
const INTERACTIVE_EDITOR_BRIDGE = true

type PreviewSessionSnapshot = {
  previewUrl: string | null
  sessionToken: string | null
  handshake: string | null
  html: string
}

const EMPTY_PREVIEW_SESSION: PreviewSessionSnapshot = {
  previewUrl: null,
  sessionToken: null,
  handshake: null,
  html: '',
}

export function useSandboxPreview(html: string, enabled: boolean): SandboxPreviewState {
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

  useEffect(() => {
    let effectActive = true

    function clearPendingTimer() {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = null
      }
    }

    function abortActiveRequest() {
      const activeRequest = activeRequestRef.current

      if (!activeRequest) {
        return
      }

      requestIdRef.current += 1
      activeRequest.controller.abort()
      activeRequestRef.current = null
    }

    function settleIdleState() {
      void Promise.resolve().then(() => {
        if (!effectActive) {
          return
        }

        setIsLoading(false)
        setError(null)
      })
    }

    function latestSessionMatches() {
      const session = previewSessionRef.current

      return session.previewUrl !== null && session.html === html
    }

    async function createPreviewSession(requestHtml: string) {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const controller = new AbortController()
      activeRequestRef.current = { requestId, controller }
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/preview-sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            html: requestHtml,
            editorBridge: INTERACTIVE_EDITOR_BRIDGE,
          }),
          signal: controller.signal,
        })

        const payload = await fetchApiJsonOrThrow(response, previewSessionResponseSchema, {
          fallbackMessage: 'Failed to create preview session.',
        })

        if (requestIdRef.current !== requestId) {
          return
        }

        setPreviewSession({
          previewUrl: buildSandboxRenderUrl(payload.token, {
            sandboxOrigin: payload.sandboxOrigin || sandboxOrigin,
            appOrigin,
          }),
          sessionToken: payload.token,
          handshake: payload.handshake,
          html: requestHtml,
        })
      } catch (caught) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return
        }

        const message =
          caught instanceof Error ? caught.message : 'Failed to create preview session.'

        setError(message)
      } finally {
        if (activeRequestRef.current?.requestId === requestId) {
          activeRequestRef.current = null
        }

        if (requestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    }

    clearPendingTimer()

    if (!shouldLoad || !html.trim()) {
      observedHtmlRef.current = html
      lastHtmlChangeAtRef.current = null
      abortActiveRequest()
      settleIdleState()
      return () => {
        effectActive = false
      }
    }

    if (latestSessionMatches()) {
      abortActiveRequest()
      settleIdleState()
      return () => {
        effectActive = false
      }
    }

    const previousObservedHtml = observedHtmlRef.current
    const htmlChanged = previousObservedHtml !== html
    const now = Date.now()
    const isRapidHtmlChange =
      htmlChanged &&
      lastHtmlChangeAtRef.current !== null &&
      now - lastHtmlChangeAtRef.current < PREVIEW_SESSION_COALESCE_MS

    observedHtmlRef.current = html

    if (htmlChanged) {
      lastHtmlChangeAtRef.current = now
    }

    abortActiveRequest()
    setIsLoading(true)
    setError(null)

    if (isRapidHtmlChange) {
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null
        void createPreviewSession(html)
      }, PREVIEW_SESSION_COALESCE_MS)
    } else {
      void createPreviewSession(html)
    }

    return () => {
      effectActive = false
      clearPendingTimer()
      abortActiveRequest()
    }
  }, [appOrigin, html, sandboxOrigin, shouldLoad])

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

  // HTML-only mismatch: keep the last successful URL/token/handshake so the
  // bridge stays armed for the content still on screen while the refresh runs.
  const isStale = previewSession.previewUrl !== null && previewSession.html !== html

  return {
    previewUrl: previewSession.previewUrl,
    sandboxOrigin,
    appOrigin,
    isLoading,
    isStale,
    error,
    sessionToken: previewSession.sessionToken,
    handshake: previewSession.handshake,
  }
}

/** Client-side generation handshake and editor-channel capability for srcDoc fallback. */
export function createClientPreviewHandshake(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }

  return `srcdoc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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

  // Mix in length so empty/short strings still differ from collisions.
  hash ^= html.length
  return (hash >>> 0).toString(36)
}

export function useMemoizedClientHandshake(iframeIdentity: string): string {
  return useMemo(() => {
    if (!iframeIdentity) {
      return ''
    }

    return createClientPreviewHandshake()
  }, [iframeIdentity])
}
