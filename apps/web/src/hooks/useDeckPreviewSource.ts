import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { PatchDeckResponse } from '@/lib/deck-api'
import { TRANSIENT_ELEMENT_ID_PREFIX } from '@ark/deck-core/deck-metadata.ts'

export type DeckPreviewPatchResult = Pick<PatchDeckResponse, 'patch'> & {
  deck?: Pick<PatchDeckResponse['deck'], 'html'>
}

export function useDeckPreviewSource(deckId: string | null, html: string) {
  const [source, setSource] = useState(() => ({ deckId, html, reloadRevision: 0 }))
  const canonicalRef = useRef({ deckId, html })
  const observedRef = useRef({ deckId, html })
  const livePatchPendingRef = useRef(false)
  const expectedLiveHtmlRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    canonicalRef.current = { deckId, html }
    const observed = observedRef.current

    if (observed.deckId !== deckId) {
      observedRef.current = { deckId, html }
      livePatchPendingRef.current = false
      expectedLiveHtmlRef.current = null
      setSource((current) => ({
        deckId,
        html,
        reloadRevision: current.reloadRevision + 1,
      }))
      return
    }

    if (observed.html === html) {
      return
    }

    observedRef.current = { deckId, html }

    if (livePatchPendingRef.current || expectedLiveHtmlRef.current === html) {
      if (expectedLiveHtmlRef.current === html) {
        expectedLiveHtmlRef.current = null
      }
      return
    }

    setSource((current) => ({
      ...current,
      deckId,
      html,
      reloadRevision: current.html === html ? current.reloadRevision + 1 : current.reloadRevision,
    }))
  }, [deckId, html])

  const beginLivePatch = useCallback((elementId: string) => {
    if (elementId.startsWith(TRANSIENT_ELEMENT_ID_PREFIX) || livePatchPendingRef.current) {
      return false
    }

    livePatchPendingRef.current = true
    expectedLiveHtmlRef.current = null
    return true
  }, [])

  const rollbackLivePatch = useCallback(() => {
    const canonical = canonicalRef.current

    livePatchPendingRef.current = false
    expectedLiveHtmlRef.current = null
    observedRef.current = canonical
    setSource((current) => ({
      deckId: canonical.deckId,
      html: canonical.html,
      reloadRevision: current.reloadRevision + 1,
    }))
  }, [])

  const finishLivePatch = useCallback(
    (result: DeckPreviewPatchResult | undefined) => {
      livePatchPendingRef.current = false

      if (!result) {
        rollbackLivePatch()
        return
      }

      const resultHtml = result.deck?.html
      const observed = observedRef.current
      expectedLiveHtmlRef.current =
        resultHtml && (observed.deckId !== deckId || observed.html !== resultHtml)
          ? resultHtml
          : null
    },
    [deckId, rollbackLivePatch],
  )

  const matchesDeck = source.deckId === deckId

  return {
    previewHtml: matchesDeck ? source.html : html,
    previewReloadRevision: source.reloadRevision + (matchesDeck ? 0 : 1),
    beginLivePatch,
    finishLivePatch,
    rollbackLivePatch,
  }
}
