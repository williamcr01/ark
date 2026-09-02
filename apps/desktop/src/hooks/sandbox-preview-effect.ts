import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import {
  createSandboxPreviewSession,
  PREVIEW_SESSION_COALESCE_MS,
  type PreviewSessionSnapshot,
  type SandboxPreviewRequestRefs,
} from './sandbox-preview-session.ts'

type SandboxPreviewEffectArgs = {
  html: string
  reloadRevision: number
  shouldLoad: boolean
  deckId?: string | null
  sandboxOrigin: string
  appOrigin: string
  refs: SandboxPreviewRequestRefs & {
    pendingTimerRef: MutableRefObject<number | null>
    observedHtmlRef: MutableRefObject<string | null>
    lastHtmlChangeAtRef: MutableRefObject<number | null>
    previewSessionRef: MutableRefObject<PreviewSessionSnapshot>
  }
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setPreviewSession: Dispatch<SetStateAction<PreviewSessionSnapshot>>
}

export function runSandboxPreviewEffect(args: SandboxPreviewEffectArgs) {
  let effectActive = true

  function clearPendingTimer() {
    if (args.refs.pendingTimerRef.current !== null) {
      window.clearTimeout(args.refs.pendingTimerRef.current)
      args.refs.pendingTimerRef.current = null
    }
  }

  function abortActiveRequest() {
    const activeRequest = args.refs.activeRequestRef.current

    if (!activeRequest) {
      return
    }

    args.refs.requestIdRef.current += 1
    activeRequest.controller.abort()
    args.refs.activeRequestRef.current = null
  }

  function settleIdleState() {
    void Promise.resolve().then(() => {
      if (!effectActive) {
        return
      }

      args.setIsLoading(false)
      args.setError(null)
    })
  }

  function latestSessionMatches() {
    const session = args.refs.previewSessionRef.current

    return (
      session.previewUrl !== null &&
      session.html === args.html &&
      session.reloadRevision === args.reloadRevision
    )
  }

  clearPendingTimer()

  if (!args.shouldLoad || !args.html.trim()) {
    args.refs.observedHtmlRef.current = args.html
    args.refs.lastHtmlChangeAtRef.current = null
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

  const previousObservedHtml = args.refs.observedHtmlRef.current
  const htmlChanged = previousObservedHtml !== args.html
  const now = Date.now()
  const isRapidHtmlChange =
    htmlChanged &&
    args.refs.lastHtmlChangeAtRef.current !== null &&
    now - args.refs.lastHtmlChangeAtRef.current < PREVIEW_SESSION_COALESCE_MS

  args.refs.observedHtmlRef.current = args.html

  if (htmlChanged) {
    args.refs.lastHtmlChangeAtRef.current = now
  }

  abortActiveRequest()
  args.setIsLoading(true)
  args.setError(null)

  const startSession = () =>
    createSandboxPreviewSession({
      requestHtml: args.html,
      requestReloadRevision: args.reloadRevision,
      deckId: args.deckId,
      sandboxOrigin: args.sandboxOrigin,
      appOrigin: args.appOrigin,
      refs: args.refs,
      setIsLoading: args.setIsLoading,
      setError: args.setError,
      setPreviewSession: args.setPreviewSession,
    })

  if (isRapidHtmlChange) {
    args.refs.pendingTimerRef.current = window.setTimeout(() => {
      args.refs.pendingTimerRef.current = null
      void startSession()
    }, PREVIEW_SESSION_COALESCE_MS)
  } else {
    void startSession()
  }

  return () => {
    effectActive = false
    clearPendingTimer()
    abortActiveRequest()
  }
}
