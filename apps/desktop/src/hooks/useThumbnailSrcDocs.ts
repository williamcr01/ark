import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ParsedDeck } from '@/lib/deck/deck-slides'
import {
  cancelThumbnailFrame,
  requestThumbnailFrame,
  type ScheduledThumbnailFrame,
} from '@/lib/deck/thumbnail-strip'

type ThumbnailSrcDocCacheEntry = {
  identity: string
  srcDoc: string
}

type SrcDocCache = { entries: Map<number, ThumbnailSrcDocCacheEntry> }

function thumbnailSrcDocIdentity(parsedDeck: ParsedDeck, index: number) {
  return `${parsedDeck.thumbnailSharedKey}\0${index}\0${parsedDeck.slides[index]?.outerHTML ?? ''}`
}

function readCachedSrcDoc(cache: SrcDocCache, parsedDeck: ParsedDeck, index: number) {
  const cached = cache.entries.get(index)
  return cached?.identity === thumbnailSrcDocIdentity(parsedDeck, index) ? cached.srcDoc : null
}

function cacheThumbnailSrcDoc(cache: SrcDocCache, parsedDeck: ParsedDeck, index: number) {
  const identity = thumbnailSrcDocIdentity(parsedDeck, index)
  const cached = cache.entries.get(index)

  if (cached?.identity === identity) {
    return cached.srcDoc
  }

  const srcDoc = parsedDeck.getThumbnailSrcDoc(index)
  cache.entries.set(index, { identity, srcDoc })
  return srcDoc
}

function scheduleFallbackSrcDocs(options: {
  activeIndex: number
  bumpVersion: () => void
  cache: SrcDocCache
  candidateIndices: number[]
  parsedDeck: ParsedDeck
}) {
  const { activeIndex, bumpVersion, cache, candidateIndices, parsedDeck } = options
  let cancelled = false
  let scheduledFrame: ScheduledThumbnailFrame | null = null
  const pendingIndices = candidateIndices.filter(
    (index) => index !== activeIndex && !readCachedSrcDoc(cache, parsedDeck, index),
  )

  const buildNext = () => {
    if (cancelled) return

    const index = pendingIndices.shift()
    if (index === undefined) return

    cacheThumbnailSrcDoc(cache, parsedDeck, index)
    bumpVersion()

    if (pendingIndices.length > 0) {
      scheduledFrame = requestThumbnailFrame(buildNext)
    }
  }

  if (pendingIndices.length > 0) {
    scheduledFrame = requestThumbnailFrame(buildNext)
  }

  return () => {
    cancelled = true
    if (scheduledFrame) cancelThumbnailFrame(scheduledFrame)
  }
}

export function useThumbnailSrcDocs({
  activeIndex,
  contentEnabled,
  isOpen,
  mountedIndices,
  parsedDeck,
  thumbnailUrls,
}: {
  activeIndex: number
  contentEnabled: boolean
  isOpen: boolean
  mountedIndices: Set<number>
  parsedDeck: ParsedDeck
  thumbnailUrls?: (string | null)[] | null
}) {
  const [failedThumbnailUrls, setFailedThumbnailUrls] = useState<ReadonlyMap<number, string>>(
    () => new Map(),
  )
  const [, setThumbnailSrcDocVersion] = useState(0)
  const thumbnailSrcDocCache = useMemo(
    () => ({ entries: new Map<number, ThumbnailSrcDocCacheEntry>() }),
    [],
  )

  const getUsableThumbnailUrl = useCallback(
    (index: number) => {
      const thumbnailUrl = thumbnailUrls?.[index] ?? null
      if (!thumbnailUrl || failedThumbnailUrls.get(index) === thumbnailUrl) {
        return null
      }
      return thumbnailUrl
    },
    [failedThumbnailUrls, thumbnailUrls],
  )

  const getCachedThumbnailSrcDoc = useCallback(
    (index: number) => cacheThumbnailSrcDoc(thumbnailSrcDocCache, parsedDeck, index),
    [parsedDeck, thumbnailSrcDocCache],
  )

  const getExistingThumbnailSrcDoc = useCallback(
    (index: number) => readCachedSrcDoc(thumbnailSrcDocCache, parsedDeck, index),
    [parsedDeck, thumbnailSrcDocCache],
  )

  const fallbackCandidateIndices = useMemo(() => {
    if (!contentEnabled || !isOpen) {
      return []
    }

    return [...mountedIndices]
      .filter((index) => !getUsableThumbnailUrl(index))
      .sort(
        (left, right) =>
          Number(right === activeIndex) - Number(left === activeIndex) ||
          Math.abs(left - activeIndex) - Math.abs(right - activeIndex) ||
          left - right,
      )
  }, [activeIndex, contentEnabled, getUsableThumbnailUrl, isOpen, mountedIndices])

  const handleThumbnailImageError = useCallback(
    (index: number, url: string) => {
      if (isOpen && mountedIndices.has(index)) {
        getCachedThumbnailSrcDoc(index)
      }

      setFailedThumbnailUrls((current) => {
        if (current.get(index) === url) return current
        const next = new Map(current)
        next.set(index, url)
        return next
      })
      setThumbnailSrcDocVersion((version) => version + 1)
    },
    [getCachedThumbnailSrcDoc, isOpen, mountedIndices],
  )

  useEffect(() => {
    if (!isOpen || fallbackCandidateIndices.length === 0) {
      return
    }

    return scheduleFallbackSrcDocs({
      activeIndex,
      bumpVersion: () => setThumbnailSrcDocVersion((version) => version + 1),
      cache: thumbnailSrcDocCache,
      candidateIndices: fallbackCandidateIndices,
      parsedDeck,
    })
  }, [activeIndex, fallbackCandidateIndices, isOpen, parsedDeck, thumbnailSrcDocCache])

  return {
    getCachedThumbnailSrcDoc,
    getExistingThumbnailSrcDoc,
    getUsableThumbnailUrl,
    handleThumbnailImageError,
  }
}
