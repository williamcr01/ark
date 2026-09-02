import type { MutableRefObject } from 'react'

import {
  createDeckSlideSnapshot,
  diffDeckSlideSnapshots,
  type DeckSlidePatch,
  type DeckSlideSnapshot,
} from '@ark/deck-preview/slide-patch.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

export type FrameContent = {
  html: string | null
  snapshot: DeckSlideSnapshot | null
}

export function tryApplySlidePatch(
  previousHtml: string,
  nextHtml: string,
  frameContentRef: MutableRefObject<FrameContent>,
  onSlidePatch: ((patch: DeckSlidePatch) => boolean) | undefined,
  bumpContentRevision: () => void,
) {
  const frameContent = frameContentRef.current

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
    bumpContentRevision()
  }

  return true
}

export function applyCanonicalHtmlChange(args: {
  deckId: string | null
  html: string
  canonicalRef: MutableRefObject<{ deckId: string | null; html: string }>
  observedRef: MutableRefObject<{ deckId: string | null; html: string }>
  livePatchPendingRef: MutableRefObject<boolean>
  expectedLiveHtmlRef: MutableRefObject<string | null>
  frameContentRef: MutableRefObject<FrameContent>
  setLivePatchPending: (value: boolean) => void
  bumpContentRevision: () => void
  reloadSource: (deckId: string | null, html: string, bumpReload: boolean) => void
  trySlidePatch: (previousHtml: string, nextHtml: string) => boolean
}) {
  args.canonicalRef.current = { deckId: args.deckId, html: args.html }
  const observed = args.observedRef.current

  if (observed.deckId !== args.deckId) {
    args.observedRef.current = { deckId: args.deckId, html: args.html }
    args.livePatchPendingRef.current = false
    args.setLivePatchPending(false)
    args.expectedLiveHtmlRef.current = null
    args.frameContentRef.current = { html: args.html, snapshot: null }
    args.bumpContentRevision()
    args.reloadSource(args.deckId, args.html, true)
    return
  }

  if (observed.html === args.html) {
    return
  }

  const previousHtml = observed.html
  args.observedRef.current = { deckId: args.deckId, html: args.html }

  if (args.livePatchPendingRef.current || args.expectedLiveHtmlRef.current === args.html) {
    const matchesLiveDom = args.expectedLiveHtmlRef.current === args.html

    if (matchesLiveDom) {
      args.expectedLiveHtmlRef.current = null
    }

    args.frameContentRef.current = { html: matchesLiveDom ? args.html : null, snapshot: null }
    return
  }

  if (args.trySlidePatch(previousHtml, args.html)) {
    return
  }

  args.frameContentRef.current = { html: args.html, snapshot: null }
  args.bumpContentRevision()
  args.reloadSource(args.deckId, args.html, false)
}
