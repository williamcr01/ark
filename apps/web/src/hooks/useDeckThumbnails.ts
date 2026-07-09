import { useEffect, useRef, useState } from 'react'

import {
  deckThumbnailsResponseSchema,
  fetchApiJsonOrThrow,
  type DeckThumbnailsResponse,
  type ThumbnailStatus,
} from '@ark/contracts'

export type DeckThumbnailsState = {
  status: ThumbnailStatus | null
  thumbnailUrls: (string | null)[] | null
  error: string | null
  isLoading: boolean
}

const PENDING_POLL_MS = 1_200
const PENDING_POLL_MAX_MS = 4_000

async function fetchDeckThumbnails(deckId: string, versionId: string) {
  const params = new URLSearchParams({ versionId })
  const response = await fetch(
    `/api/decks/${encodeURIComponent(deckId)}/thumbnails?${params.toString()}`,
  )
  return fetchApiJsonOrThrow(response, deckThumbnailsResponseSchema, {
    fallbackMessage: 'Could not load deck thumbnails.',
  })
}

function toThumbnailUrls(
  payload: DeckThumbnailsResponse,
  slideCount: number,
): (string | null)[] | null {
  if (payload.status !== 'ready' || payload.slides.length === 0) {
    return null
  }

  const urls = Array.from({ length: slideCount }, () => null as string | null)

  for (const slide of payload.slides) {
    if (slide.index >= 0 && slide.index < slideCount) {
      urls[slide.index] = slide.url
    }
  }

  return urls.every((url) => url === null) ? null : urls
}

export function useDeckThumbnails(
  deckId: string | null | undefined,
  versionId: string | null | undefined,
  slideCount: number,
): DeckThumbnailsState {
  const enabled = Boolean(deckId && versionId && slideCount > 0)
  const [status, setStatus] = useState<ThumbnailStatus | null>(null)
  const [thumbnailUrls, setThumbnailUrls] = useState<(string | null)[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)
  // Once the API reports the renderer is disabled, skip further fetches for this
  // deck. Rapid undo/redo otherwise hammers /thumbnails and remounts strip work
  // during preview reloads (manual-edit smoke).
  const rendererDisabledRef = useRef(false)
  const disabledForDeckIdRef = useRef<string | null>(null)

  if (deckId !== disabledForDeckIdRef.current) {
    disabledForDeckIdRef.current = deckId ?? null
    rendererDisabledRef.current = false
  }

  useEffect(() => {
    if (!enabled || !deckId || !versionId) {
      return
    }

    if (rendererDisabledRef.current) {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const requestId = ++requestIdRef.current
    let attempt = 0

    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const schedulePoll = () => {
      const delay = Math.min(PENDING_POLL_MS * 2 ** attempt, PENDING_POLL_MAX_MS)
      attempt += 1
      timeoutId = setTimeout(() => {
        void load()
      }, delay)
    }

    const load = async () => {
      setIsLoading(true)

      try {
        const payload = await fetchDeckThumbnails(deckId, versionId)

        if (cancelled || requestId !== requestIdRef.current) {
          return
        }

        if (payload.status === 'disabled') {
          rendererDisabledRef.current = true
        }

        setStatus(payload.status)
        setError(payload.error ?? null)

        if (payload.status === 'ready') {
          setThumbnailUrls(toThumbnailUrls(payload, slideCount))
          setIsLoading(false)
          return
        }

        setThumbnailUrls(null)

        if (payload.status === 'pending') {
          schedulePoll()
          return
        }

        setIsLoading(false)
      } catch (loadError) {
        if (cancelled || requestId !== requestIdRef.current) {
          return
        }

        setStatus(null)
        setThumbnailUrls(null)
        setError(loadError instanceof Error ? loadError.message : 'Could not load deck thumbnails.')
        setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
      clearTimer()
    }
  }, [deckId, enabled, slideCount, versionId])

  if (!enabled) {
    return {
      status: null,
      thumbnailUrls: null,
      error: null,
      isLoading: false,
    }
  }

  if (rendererDisabledRef.current) {
    return {
      status: 'disabled',
      thumbnailUrls: null,
      error: null,
      isLoading: false,
    }
  }

  return {
    status,
    thumbnailUrls,
    error,
    isLoading,
  }
}
