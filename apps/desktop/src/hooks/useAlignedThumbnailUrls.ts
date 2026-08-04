import { useEffect, useMemo, useRef } from 'react'

import type { ParsedDeck } from '@/lib/deck-slides'

type AlignableDeck = Pick<ParsedDeck, 'slides'>

/**
 * Re-key stale per-index thumbnail URLs onto the deck they are about to be
 * shown against by matching slide content. Structural edits such as reorders
 * only permute slides, so every already-rendered PNG can be reused instantly
 * at its new index instead of showing the previous arrangement while the
 * server re-renders the whole deck.
 *
 * Slides whose content has no match (in-place edits) keep the same-index URL,
 * preserving the existing "stale pixels until re-render" behavior instead of
 * flashing a skeleton.
 */
export function alignThumbnailUrls(
  anchorDeck: AlignableDeck,
  urls: (string | null)[],
  nextDeck: AlignableDeck,
): (string | null)[] {
  const availableByContent = new Map<string, number[]>()

  anchorDeck.slides.forEach((slide, index) => {
    if (!urls[index]) return

    const indexes = availableByContent.get(slide.outerHTML)
    if (indexes) {
      indexes.push(index)
    } else {
      availableByContent.set(slide.outerHTML, [index])
    }
  })

  return nextDeck.slides.map((slide, index) => {
    const matchIndex = availableByContent.get(slide.outerHTML)?.shift()
    return matchIndex !== undefined ? (urls[matchIndex] ?? null) : (urls[index] ?? null)
  })
}

/**
 * Thumbnail URLs lag the deck: after a revision change the poller keeps the
 * previous revision's URLs until the renderer produces new ones. Anchor each
 * incoming URL array to the deck that was current when it arrived; when the
 * deck changes while the URLs are still the anchored (stale) ones, re-align
 * them by slide content so the strip shows the new arrangement immediately.
 */
export function useAlignedThumbnailUrls(
  parsedDeck: AlignableDeck,
  thumbnailUrls: (string | null)[] | null,
): (string | null)[] | null {
  const anchorRef = useRef<{ deck: AlignableDeck; urls: (string | null)[] } | null>(null)
  const parsedDeckRef = useRef(parsedDeck)

  useEffect(() => {
    parsedDeckRef.current = parsedDeck
  }, [parsedDeck])

  // Anchor only when the URL array itself changes: fresh URLs are rendered
  // from the document revision that is current at arrival time. Deck changes with
  // unchanged URLs are exactly the stale window this hook re-aligns.
  useEffect(() => {
    anchorRef.current = thumbnailUrls ? { deck: parsedDeckRef.current, urls: thumbnailUrls } : null
  }, [thumbnailUrls])

  return useMemo(() => {
    const anchor = anchorRef.current

    if (!thumbnailUrls || !anchor || anchor.urls !== thumbnailUrls || anchor.deck === parsedDeck) {
      return thumbnailUrls
    }

    return alignThumbnailUrls(anchor.deck, thumbnailUrls, parsedDeck)
  }, [parsedDeck, thumbnailUrls])
}
