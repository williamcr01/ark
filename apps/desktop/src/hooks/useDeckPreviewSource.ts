import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import {
  createDeckSlideSnapshot,
  diffDeckSlideSnapshots,
  type DeckSlidePatch,
  type DeckSlideSnapshot,
} from '@ark/deck-preview/slide-patch.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

import type { PatchDeckResponse } from '@/lib/api/deck-api'
export type DeckPreviewPatchResult = Pick<PatchDeckResponse, 'patch'> & {
  deck?: Pick<PatchDeckResponse['deck'], 'html'>
}

export type DeckPreviewSourceOptions = {
  /**
   * Dispatch a slide-level patch to the loaded preview. Returning true keeps
   * the current iframe; returning false falls back to a full reload.
   */
  onSlidePatch?: (patch: DeckSlidePatch) => boolean
}

/** What the loaded preview frame's DOM currently reflects. */
type FrameContent = {
  /** Deck HTML the frame's slides match, or null when they match nothing known. */
  html: string | null
  /** Cached snapshot for `html`, computed on first use. */
  snapshot: DeckSlideSnapshot | null
}

export function useDeckPreviewSource(
  deckId: string | null,
  html: string,
  options: DeckPreviewSourceOptions = {},
) {
  const [source, setSource] = useState(() => ({ deckId, html, reloadRevision: 0 }))
  // Bumped by reloads and by in-place slide patches, so consumers can react to
  // "the preview shows different content now" without watching previewHtml.
  const [contentRevision, setContentRevision] = useState(0)
  // True while a pointer-up live patch is in flight — thumbnail polling must wait
  // so it cannot compete with the commit path (issue #287).
  const [livePatchPending, setLivePatchPending] = useState(false)
  const canonicalRef = useRef({ deckId, html })
  const observedRef = useRef({ deckId, html })
  const livePatchPendingRef = useRef(false)
  const expectedLiveHtmlRef = useRef<string | null>(null)
  const frameContentRef = useRef<FrameContent>({ html, snapshot: null })
  const onSlidePatchRef = useRef(options.onSlidePatch)

  // Declared before the source effect so it is current when that effect runs.
  useLayoutEffect(() => {
    onSlidePatchRef.current = options.onSlidePatch
  }, [options.onSlidePatch])

  const trySlidePatch = useCallback((previousHtml: string, nextHtml: string) => {
    const onSlidePatch = onSlidePatchRef.current
    const frameContent = frameContentRef.current

    // Only patch when the frame is known to render exactly `previousHtml`.
    if (!onSlidePatch || frameContent.html !== previousHtml) {
      return false
    }

    const assetOrigin = resolveAppOrigin()
    const previous = frameContent.snapshot ?? createDeckSlideSnapshot(previousHtml, { assetOrigin })

    if (!previous) {
      return false
    }

    frameContentRef.current = { html: previousHtml, snapshot: previous }

    const next = createDeckSlideSnapshot(nextHtml, { assetOrigin })

    if (!next) {
      return false
    }

    const patch = diffDeckSlideSnapshots(previous, next)

    if (!patch) {
      return false
    }

    if (patch.operations.length > 0 && !onSlidePatch(patch)) {
      return false
    }

    frameContentRef.current = { html: nextHtml, snapshot: next }

    if (patch.operations.length > 0) {
      setContentRevision((current) => current + 1)
    }

    return true
  }, [])

  useLayoutEffect(() => {
    canonicalRef.current = { deckId, html }
    const observed = observedRef.current

    if (observed.deckId !== deckId) {
      observedRef.current = { deckId, html }
      livePatchPendingRef.current = false
      setLivePatchPending(false)
      expectedLiveHtmlRef.current = null
      frameContentRef.current = { html, snapshot: null }
      setContentRevision((current) => current + 1)
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

    const previousHtml = observed.html
    observedRef.current = { deckId, html }

    if (livePatchPendingRef.current || expectedLiveHtmlRef.current === html) {
      const matchesLiveDom = expectedLiveHtmlRef.current === html

      if (matchesLiveDom) {
        expectedLiveHtmlRef.current = null
      }

      // The editor runtime already mutated the DOM. Once the saved HTML lands
      // it describes what is on screen again and slide patching can resume.
      frameContentRef.current = { html: matchesLiveDom ? html : null, snapshot: null }
      return
    }

    if (trySlidePatch(previousHtml, html)) {
      return
    }

    frameContentRef.current = { html, snapshot: null }
    setContentRevision((current) => current + 1)
    setSource((current) => ({
      ...current,
      deckId,
      html,
      reloadRevision: current.html === html ? current.reloadRevision + 1 : current.reloadRevision,
    }))
  }, [deckId, html, trySlidePatch])

  const beginLivePatch = useCallback((_elementId: string) => {
    // Transient ids are fine: the runtime already mutated the live DOM, and the
    // patch coordinator remaps reselection to the stable id from the response.
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
        // Saved HTML now describes the DOM the editor mutated, so slide-level
        // patching can resume without a reload.
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
