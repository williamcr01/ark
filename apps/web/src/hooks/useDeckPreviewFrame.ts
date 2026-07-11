import { useMemo, useState } from 'react'

import {
  fingerprintPreviewHtml,
  useMemoizedClientHandshake,
  useSandboxPreview,
} from '@/hooks/useSandboxPreview'
import { getPreviewHtml, useSrcDocPreviewFallback } from '@/lib/deck-preview'

export type DeckPreviewFrameOptions = {
  editorBridge?: boolean
}

export type DeckPreviewFrameModel = {
  iframeKey: string
  iframeSrc?: string
  iframeSrcDoc?: string
  sandboxOrigin: string | null
  isLoading: boolean
  error: string | null
  usesSandboxHost: boolean
  /** Generation-correlation handshake for the bridge session (not a secret). */
  handshake: string | null
}

export function useDeckPreviewFrame(
  html: string,
  enabled: boolean,
  _options: DeckPreviewFrameOptions = {},
): DeckPreviewFrameModel {
  const usesSrcDocFallback = useSrcDocPreviewFallback()
  const sandboxPreview = useSandboxPreview(html, enabled && !usesSrcDocFallback)

  const srcDocHtml =
    usesSrcDocFallback && enabled && html.trim() ? getPreviewHtml(html, { editorBridge: true }) : ''
  const contentFingerprint = fingerprintPreviewHtml(usesSrcDocFallback ? srcDocHtml || html : html)
  const contentIdentity = usesSrcDocFallback
    ? `srcdoc:${contentFingerprint}`
    : `sandbox:${sandboxPreview.sessionToken ?? sandboxPreview.previewUrl ?? `pending:${contentFingerprint}`}`

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
    sandboxPreview.previewUrl,
    sandboxPreview.sandboxOrigin,
    srcDocHandshake,
    usesSrcDocFallback,
  ])
}
