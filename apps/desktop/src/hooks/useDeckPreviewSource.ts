import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { DeckSlidePatch } from '@ark/deck-preview/slide-patch.ts'

import {
  applyCanonicalHtmlChange,
  tryApplySlidePatch,
  type FrameContent,
} from './deck-preview-source-apply.ts'
import type { PatchDeckResponse } from '@/lib/api/deck-api'

export type DeckPreviewPatchResult = Pick<PatchDeckResponse, 'patch'> & {
  deck?: Pick<PatchDeckResponse['deck'], 'html'>
}

export type DeckPreviewSourceOptions = {
  onSlidePatch?: (patch: DeckSlidePatch) => boolean
}

export function useDeckPreviewSource(
  deckId: string | null,
  html: string,
  options: DeckPreviewSourceOptions = {},
) {
  const [source, setSource] = useState(() => ({ deckId, html, reloadRevision: 0 }))
  const [contentRevision, setContentRevision] = useState(0)
  const [livePatchPending, setLivePatchPending] = useState(false)
  const canonicalRef = useRef({ deckId, html })
  const observedRef = useRef({ deckId, html })
  const livePatchPendingRef = useRef(false)
  const expectedLiveHtmlRef = useRef<string | null>(null)
  const frameContentRef = useRef<FrameContent>({ html, snapshot: null })
  const onSlidePatchRef = useRef(options.onSlidePatch)

  useLayoutEffect(() => {
    onSlidePatchRef.current = options.onSlidePatch
  }, [options.onSlidePatch])

  const trySlidePatch = useCallback((previousHtml: string, nextHtml: string) => {
    return tryApplySlidePatch(
      previousHtml,
      nextHtml,
      frameContentRef,
      onSlidePatchRef.current,
      () => setContentRevision((current) => current + 1),
    )
  }, [])

  useLayoutEffect(() => {
    applyCanonicalHtmlChange({
      deckId,
      html,
      canonicalRef,
      observedRef,
      livePatchPendingRef,
      expectedLiveHtmlRef,
      frameContentRef,
      setLivePatchPending,
      bumpContentRevision: () => setContentRevision((current) => current + 1),
      reloadSource: (nextDeckId, nextHtml, bumpReload) => {
        setSource((current) =>
          bumpReload
            ? { deckId: nextDeckId, html: nextHtml, reloadRevision: current.reloadRevision + 1 }
            : {
                ...current,
                deckId: nextDeckId,
                html: nextHtml,
                reloadRevision:
                  current.html === nextHtml ? current.reloadRevision + 1 : current.reloadRevision,
              },
        )
      },
      trySlidePatch,
    })
  }, [deckId, html, trySlidePatch])

  const beginLivePatch = useCallback((_elementId: string) => {
    if (livePatchPendingRef.current) {
      return false
    }
    livePatchPendingRef.current = true
    setLivePatchPending(true)
    expectedLiveHtmlRef.current = null
    return true
  }, [])

  const rollbackLivePatch = useCallback(() => {
    if (canonicalRef.current.deckId !== deckId) {
      return
    }
    const canonical = canonicalRef.current
    livePatchPendingRef.current = false
    setLivePatchPending(false)
    expectedLiveHtmlRef.current = null
    observedRef.current = canonical
    frameContentRef.current = { html: canonical.html, snapshot: null }
    setContentRevision((current) => current + 1)
    setSource((current) => ({
      deckId: canonical.deckId,
      html: canonical.html,
      reloadRevision: current.reloadRevision + 1,
    }))
  }, [deckId])

  const finishLivePatch = useCallback(
    (result: DeckPreviewPatchResult | undefined) => {
      if (canonicalRef.current.deckId !== deckId) {
        return
      }
      livePatchPendingRef.current = false
      setLivePatchPending(false)
      if (!result) {
        rollbackLivePatch()
        return
      }
      const resultHtml = result.deck?.html
      const observed = observedRef.current
      const alreadyObserved =
        Boolean(resultHtml) && observed.deckId === deckId && observed.html === resultHtml
      expectedLiveHtmlRef.current = resultHtml && !alreadyObserved ? resultHtml : null
      if (resultHtml && alreadyObserved) {
        frameContentRef.current = { html: resultHtml, snapshot: null }
      }
    },
    [deckId, rollbackLivePatch],
  )

  const matchesDeck = source.deckId === deckId

  return {
    previewHtml: matchesDeck ? source.html : html,
    previewReloadRevision: source.reloadRevision + (matchesDeck ? 0 : 1),
    previewContentRevision: contentRevision,
    livePatchPending,
    beginLivePatch,
    finishLivePatch,
    rollbackLivePatch,
  }
}
