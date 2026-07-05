import { useMemo } from 'react'

import { useSandboxPreview } from '@/hooks/useSandboxPreview'
import { getPreviewHtml, useSrcDocPreviewFallback } from '@/lib/deck-preview'

export type DeckPreviewFrameModel = {
  iframeKey: string
  iframeSrc?: string
  iframeSrcDoc?: string
  sandboxOrigin: string | null
  isLoading: boolean
  error: string | null
  usesSandboxHost: boolean
}

export function useDeckPreviewFrame(html: string, enabled: boolean): DeckPreviewFrameModel {
  const usesSrcDocFallback = useSrcDocPreviewFallback()
  const sandboxPreview = useSandboxPreview(html, enabled && !usesSrcDocFallback)

  return useMemo(() => {
    if (usesSrcDocFallback || !enabled || !html.trim()) {
      return {
        iframeKey: usesSrcDocFallback ? `srcdoc:${html.length}` : 'empty',
        iframeSrcDoc: enabled && html.trim() ? getPreviewHtml(html) : undefined,
        sandboxOrigin: null,
        isLoading: false,
        error: null,
        usesSandboxHost: false,
      }
    }

    return {
      iframeKey:
        sandboxPreview.sessionToken ?? sandboxPreview.previewUrl ?? `pending:${html.length}`,
      iframeSrc: sandboxPreview.previewUrl ?? undefined,
      sandboxOrigin: sandboxPreview.sandboxOrigin,
      isLoading: sandboxPreview.isLoading,
      error: sandboxPreview.error,
      usesSandboxHost: true,
    }
  }, [
    enabled,
    html,
    sandboxPreview.error,
    sandboxPreview.isLoading,
    sandboxPreview.previewUrl,
    sandboxPreview.sandboxOrigin,
    sandboxPreview.sessionToken,
    usesSrcDocFallback,
  ])
}
