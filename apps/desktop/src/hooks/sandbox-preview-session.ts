import { previewSessionResponseSchema, fetchApiJsonOrThrow } from '@ark/contracts'
import { buildSandboxRenderUrl } from '@ark/runtime-registry/sandbox-origin.ts'

export const PREVIEW_SESSION_COALESCE_MS = 100

export type PreviewSessionSnapshot = {
  previewUrl: string | null
  sandboxOrigin: string | null
  sessionToken: string | null
  handshake: string | null
  html: string
  reloadRevision: number
}

export const EMPTY_PREVIEW_SESSION: PreviewSessionSnapshot = {
  previewUrl: null,
  sandboxOrigin: null,
  sessionToken: null,
  handshake: null,
  html: '',
  reloadRevision: 0,
}

export type SandboxPreviewRequestRefs = {
  requestIdRef: { current: number }
  activeRequestRef: { current: { requestId: number; controller: AbortController } | null }
}

export async function createSandboxPreviewSession(args: {
  requestHtml: string
  requestReloadRevision: number
  deckId?: string | null
  sandboxOrigin: string
  appOrigin: string
  refs: SandboxPreviewRequestRefs
  setIsLoading: (value: boolean | ((current: boolean) => boolean)) => void
  setError: (value: string | null) => void
  setPreviewSession: (value: PreviewSessionSnapshot) => void
}) {
  const requestId = args.refs.requestIdRef.current + 1
  args.refs.requestIdRef.current = requestId
  const controller = new AbortController()
  args.refs.activeRequestRef.current = { requestId, controller }
  args.setIsLoading(true)
  args.setError(null)

  try {
    const response = await fetch('/api/preview-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: args.requestHtml,
        ...(args.deckId ? { deckId: args.deckId } : {}),
        editorBridge: true,
      }),
      signal: controller.signal,
    })

    const payload = await fetchApiJsonOrThrow(response, previewSessionResponseSchema, {
      fallbackMessage: 'Failed to create preview session.',
    })

    if (args.refs.requestIdRef.current !== requestId) {
      return
    }

    args.setPreviewSession({
      previewUrl: buildSandboxRenderUrl(payload.token, {
        sandboxOrigin: payload.sandboxOrigin || args.sandboxOrigin,
        appOrigin: args.appOrigin,
      }),
      sandboxOrigin: payload.sandboxOrigin || args.sandboxOrigin,
      sessionToken: payload.token,
      handshake: payload.handshake,
      html: args.requestHtml,
      reloadRevision: args.requestReloadRevision,
    })
  } catch (caught) {
    if (controller.signal.aborted || args.refs.requestIdRef.current !== requestId) {
      return
    }

    const message = caught instanceof Error ? caught.message : 'Failed to create preview session.'

    args.setError(message)
  } finally {
    if (args.refs.activeRequestRef.current?.requestId === requestId) {
      args.refs.activeRequestRef.current = null
    }

    args.setIsLoading((current) => (args.refs.requestIdRef.current === requestId ? false : current))
  }
}
