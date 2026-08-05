import { useMemo, useState } from 'react'

import { fingerprintPreviewHtml, useSandboxPreview } from '@/hooks/useSandboxPreview'

export type DeckPreviewFrameModel = {
  iframeKey: string
  iframeSrc?: string
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
  const sandboxPreview = useSandboxPreview(html, enabled, reloadRevision)
  const contentFingerprint = fingerprintPreviewHtml(html)
  const sandboxSessionIdentity = sandboxPreview.sessionToken ?? sandboxPreview.previewUrl
  const contentIdentity = `sandbox:${sandboxSessionIdentity ?? `pending:${contentFingerprint}`}:r${reloadRevision}`

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

  return useMemo(() => {
    if (!enabled || !html.trim()) {
      return {
        iframeKey: 'empty',
        sandboxOrigin: null,
        isLoading: false,
        isStale: false,
        error: null,
        usesSandboxHost: false,
        handshake: null,
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
  ])
}
