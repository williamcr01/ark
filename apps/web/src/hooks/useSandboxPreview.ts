import { useEffect, useMemo, useRef, useState } from 'react'

import { previewSessionResponseSchema, fetchApiJsonOrThrow } from '@ark/contracts'
import {
  buildSandboxRenderUrl,
  resolveAppOrigin,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

export type SandboxPreviewOptions = {
  editorBridge?: boolean
}

export type SandboxPreviewState = {
  previewUrl: string | null
  sandboxOrigin: string
  appOrigin: string
  isLoading: boolean
  error: string | null
  sessionToken: string | null
  handshake: string | null
}

const PREVIEW_SESSION_DEBOUNCE_MS = 300

export function useSandboxPreview(
  html: string,
  enabled: boolean,
  options: SandboxPreviewOptions = {},
): SandboxPreviewState {
  const sandboxOrigin = resolveSandboxOrigin()
  const appOrigin = resolveAppOrigin()
  const shouldLoad = enabled && html.trim().length > 0
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [handshake, setHandshake] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const debouncedHtmlRef = useRef(html)
  const [debouncedHtml, setDebouncedHtml] = useState(html)

  useEffect(() => {
    if (!shouldLoad) {
      debouncedHtmlRef.current = html
      return
    }

    debouncedHtmlRef.current = html

    const timer = window.setTimeout(() => {
      setDebouncedHtml(debouncedHtmlRef.current)
    }, PREVIEW_SESSION_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [html, shouldLoad])

  useEffect(() => {
    if (!shouldLoad || !debouncedHtml.trim()) {
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const controller = new AbortController()

    async function createPreviewSession() {
      setIsLoading(true)
      setError(null)
      setPreviewUrl(null)
      setSessionToken(null)
      setHandshake(null)

      try {
        const response = await fetch('/api/preview-sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            html: debouncedHtml,
            editorBridge: options.editorBridge === true,
          }),
          signal: controller.signal,
        })

        const payload = await fetchApiJsonOrThrow(response, previewSessionResponseSchema, {
          fallbackMessage: 'Failed to create preview session.',
        })

        if (requestIdRef.current !== requestId) {
          return
        }

        setSessionToken(payload.token)
        setHandshake(payload.handshake)
        setPreviewUrl(
          buildSandboxRenderUrl(payload.token, {
            sandboxOrigin: payload.sandboxOrigin || sandboxOrigin,
            appOrigin,
          }),
        )
      } catch (caught) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return
        }

        const message =
          caught instanceof Error ? caught.message : 'Failed to create preview session.'

        setPreviewUrl(null)
        setSessionToken(null)
        setHandshake(null)
        setError(message)
      } finally {
        if (requestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    }

    void createPreviewSession()

    return () => {
      controller.abort()
    }
  }, [appOrigin, debouncedHtml, options.editorBridge, sandboxOrigin, shouldLoad])

  if (!shouldLoad) {
    return {
      previewUrl: null,
      sandboxOrigin,
      appOrigin,
      isLoading: false,
      error: null,
      sessionToken: null,
      handshake: null,
    }
  }

  return {
    previewUrl,
    sandboxOrigin,
    appOrigin,
    isLoading,
    error,
    sessionToken,
    handshake,
  }
}

/** Client-side handshake for srcDoc fallback (generation correlation, not a secret). */
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
