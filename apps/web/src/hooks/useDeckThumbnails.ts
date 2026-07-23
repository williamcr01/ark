import { useEffect, useRef, useState } from 'react'

import {
  THUMBNAIL_LONG_POLL_MAX_WAIT_MS,
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

const PENDING_REPOLL_MS = 50

async function fetchDeckThumbnails(deckId: string, versionId: string, signal: AbortSignal) {
  const params = new URLSearchParams({
    versionId,
    waitMs: String(THUMBNAIL_LONG_POLL_MAX_WAIT_MS),
  })
  const response = await fetch(
    `/api/decks/${encodeURIComponent(deckId)}/thumbnails?${params.toString()}`,
    { signal },
  )
  return fetchApiJsonOrThrow(response, deckThumbnailsResponseSchema, {
    fallbackMessage: 'Could not load deck thumbnails.',
  })
}

function toThumbnailUrls(
  payload: DeckThumbnailsResponse,
  slideCount: number,
  previousUrls: (string | null)[] | null,
): (string | null)[] | null {
  if (payload.status !== 'ready' || payload.slides.length === 0) {
    return null
  }

  const urls = Array.from({ length: slideCount }, () => null as string | null)

  for (const slide of payload.slides) {
    if (slide.index >= 0 && slide.index < slideCount) {
      const previousUrl = previousUrls?.[slide.index] ?? null
      urls[slide.index] = canReuseThumbnailUrl(previousUrl, slide.url) ? previousUrl : slide.url
    }
  }

  return urls.every((url) => url === null) ? null : urls
}

function getThumbnailHash(url: string) {
  try {
    return new URL(url, 'http://ark.invalid').searchParams.get('hash')
  } catch {
    return null
  }
}

function canReuseThumbnailUrl(previousUrl: string | null, nextUrl: string) {
  if (!previousUrl) {
    return false
  }

  if (previousUrl === nextUrl) {
    return true
  }

  const previousHash = getThumbnailHash(previousUrl)
  return Boolean(previousHash && previousHash === getThumbnailHash(nextUrl))
}

export function useDeckThumbnails(
  deckId: string | null | undefined,
  versionId: string | null | undefined,
  slideCount: number,
  options: { enabled?: boolean } = {},
): DeckThumbnailsState {
  const enabled = options.enabled !== false && Boolean(deckId && versionId && slideCount > 0)
  const [status, setStatus] = useState<ThumbnailStatus | null>(null)
  const [thumbnailUrls, setThumbnailUrls] = useState<(string | null)[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)
  // Once the API reports the renderer is disabled for a deck, skip further
  // fetches for that deck. Rapid undo/redo otherwise hammers /thumbnails during
  // preview reloads (manual-edit smoke). Accessed only from effects.
  const disabledDeckIdsRef = useRef(new Set<string>())
  // Version URLs are immutable, but identical per-slide hashes point at the
  // same rendered pixels. Keep those URLs stable across edits so unchanged
  // thumbnail <img> elements do not reload.
  const stateKeyRef = useRef<{
    deckId: string
    versionId: string
    slideCount: number
  } | null>(null)

  useEffect(() => {
    if (!enabled || !deckId || !versionId) {
      return
    }

    const previousStateKey = stateKeyRef.current
    const deckOrStructureChanged =
      previousStateKey !== null &&
      (previousStateKey.deckId !== deckId || previousStateKey.slideCount !== slideCount)
    const versionChanged =
      previousStateKey === null ||
      previousStateKey.deckId !== deckId ||
      previousStateKey.versionId !== versionId ||
      previousStateKey.slideCount !== slideCount

    if (versionChanged) {
      stateKeyRef.current = { deckId, versionId, slideCount }
      setStatus(null)
      setError(null)

      if (deckOrStructureChanged) {
        setThumbnailUrls(null)
      }
    }

    if (disabledDeckIdsRef.current.has(deckId)) {
      setStatus('disabled')
      setThumbnailUrls(null)
      setError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let activeController: AbortController | null = null
    const requestId = ++requestIdRef.current

    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const schedulePoll = () => {
      timeoutId = setTimeout(() => {
        void load()
      }, PENDING_REPOLL_MS)
    }

    const load = async () => {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      setIsLoading(true)

      try {
        const payload = await fetchDeckThumbnails(deckId, versionId, controller.signal)

        if (cancelled || requestId !== requestIdRef.current) {
          return
        }

        if (payload.status === 'disabled') {
          disabledDeckIdsRef.current.add(deckId)
        }

        setStatus(payload.status)
        setError(payload.error ?? null)

        if (payload.status === 'ready') {
          setThumbnailUrls((current) => toThumbnailUrls(payload, slideCount, current))
          if (activeController === controller) {
            activeController = null
          }
          setIsLoading(false)
          return
        }

        if (payload.status === 'pending') {
          if (activeController === controller) {
            activeController = null
          }
          schedulePoll()
          return
        }

        setThumbnailUrls(null)

        if (activeController === controller) {
          activeController = null
        }
        setIsLoading(false)
      } catch (loadError) {
        if (cancelled || requestId !== requestIdRef.current) {
          return
        }

        if (loadError instanceof Error && loadError.name === 'AbortError') {
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
      activeController?.abort()
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

  return {
    status,
    thumbnailUrls,
    error,
    isLoading,
  }
}
