import { useMemo, useState } from 'react'

import {
  fingerprintPreviewHtml,
  useMemoizedClientHandshake,
  useSandboxPreview,
} from '@/hooks/useSandboxPreview'
import { getPreviewHtml, useSrcDocPreviewFallback } from '@/lib/deck-preview'

export type DeckPreviewFrameModel = {
  iframeKey: string
  iframeSrc?: string
  iframeSrcDoc?: string
  sandboxOrigin: string | null
  isLoading: boolean
  /** True while the iframe still shows an older successful session. */
  isStale: boolean
  error: string | null
  usesSandboxHost: boolean
  /** Per-generation handshake and editor-channel capability. */
  handshake: string | null
}

export function useDeckPreviewFrame(
  html: string,
  enabled: boolean,
  reloadRevision = 0,
): DeckPreviewFrameModel {
  const usesSrcDocFallback = useSrcDocPreviewFallback()
  const sandboxPreview = useSandboxPreview(html, enabled && !usesSrcDocFallback, reloadRevision)

  const srcDocHtml =
    usesSrcDocFallback && enabled && html.trim() ? getPreviewHtml(html, { editorBridge: true }) : ''
  const contentFingerprint = fingerprintPreviewHtml(usesSrcDocFallback ? srcDocHtml || html : html)
  const sandboxSessionIdentity = sandboxPreview.sessionToken ?? sandboxPreview.previewUrl
  const contentIdentity = usesSrcDocFallback
    ? `srcdoc:${contentFingerprint}:r${reloadRevision}`
    : `sandbox:${sandboxSessionIdentity ?? `pending:${contentFingerprint}`}:r${reloadRevision}`

  const [generationState, setGenerationState] = useState({
    identity: contentIdentity,
    generation: 1,
  })

  if (generationState.identity !== contentIdentity) {
    setGenerationState({
      identity: contentIdentity,
      generation: generationState.generation + 1,
    })
  }

  const generation =
    generationState.identity === contentIdentity
      ? generationState.generation
      : generationState.generation + 1

  const srcDocHandshake = useMemoizedClientHandshake(
    usesSrcDocFallback ? `${contentIdentity}:${generation}` : '',
  )

  return useMemo(() => {
    if (usesSrcDocFallback || !enabled || !html.trim()) {
      const handshake = usesSrcDocFallback && enabled && html.trim() ? srcDocHandshake : null
      const iframeSrcDoc =
        enabled && html.trim()
          ? getPreviewHtml(html, {
              editorBridge: true,
              handshake: handshake ?? undefined,
            })
          : undefined

      return {
        iframeKey: usesSrcDocFallback ? `srcdoc:${generation}:${contentFingerprint}` : 'empty',
        iframeSrcDoc,
        sandboxOrigin: null,
        isLoading: false,
        isStale: false,
        error: null,
        usesSandboxHost: false,
        handshake,
      }
    }

    return {
      iframeKey: `${contentIdentity}:g${generation}`,
      iframeSrc: sandboxPreview.previewUrl ?? undefined,
      sandboxOrigin: sandboxPreview.sandboxOrigin,
      isLoading: sandboxPreview.isLoading,
      isStale: sandboxPreview.isStale,
      error: sandboxPreview.error,
      usesSandboxHost: true,
      handshake: sandboxPreview.handshake,
    }
  }, [
    contentFingerprint,
    contentIdentity,
    enabled,
    generation,
    html,
    sandboxPreview.error,
    sandboxPreview.handshake,
    sandboxPreview.isLoading,
    sandboxPreview.isStale,
    sandboxPreview.previewUrl,
    sandboxPreview.sandboxOrigin,
    srcDocHandshake,
    usesSrcDocFallback,
  ])
}
