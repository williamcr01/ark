import { useMemo } from 'react'

import { useSandboxPreview } from '@/hooks/useSandboxPreview'
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
}

export function useDeckPreviewFrame(
  html: string,
  enabled: boolean,
  options: DeckPreviewFrameOptions = {},
): DeckPreviewFrameModel {
  const usesSrcDocFallback = useSrcDocPreviewFallback()
  const sandboxPreview = useSandboxPreview(html, enabled && !usesSrcDocFallback)

  return useMemo(() => {
    const previewOptions = { editorBridge: options.editorBridge }

    if (usesSrcDocFallback || !enabled || !html.trim()) {
      return {
        iframeKey: usesSrcDocFallback
          ? `srcdoc:${options.editorBridge ? 'edit:' : ''}${html.length}`
          : 'empty',
        iframeSrcDoc: enabled && html.trim() ? getPreviewHtml(html, previewOptions) : undefined,
        sandboxOrigin: null,
        isLoading: false,
        error: null,
        usesSandboxHost: false,
      }
    }

    return {
      iframeKey:
        sandboxPreview.sessionToken ??
        sandboxPreview.previewUrl ??
        `pending:${options.editorBridge ? 'edit:' : ''}${html.length}`,
      iframeSrc: sandboxPreview.previewUrl ?? undefined,
      sandboxOrigin: sandboxPreview.sandboxOrigin,
      isLoading: sandboxPreview.isLoading,
      error: sandboxPreview.error,
      usesSandboxHost: true,
    }
  }, [
    enabled,
    html,
    options.editorBridge,
    sandboxPreview.error,
    sandboxPreview.isLoading,
    sandboxPreview.previewUrl,
    sandboxPreview.sandboxOrigin,
    sandboxPreview.sessionToken,
    usesSrcDocFallback,
  ])
}
