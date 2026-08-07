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
/** When waitMs is 0 the server answers immediately — don't spin at 20 req/s. */
const PENDING_REPOLL_NO_WAIT_MS = 1000

function scheduleAfter(callback: () => void, delayMs: number) {
  const timeoutId = setTimeout(callback, delayMs)
  return () => clearTimeout(timeoutId)
}

async function fetchDeckThumbnails(
  deckId: string,
  documentRevision: number,
  signal: AbortSignal,
  waitMs: number,
) {
  const params = new URLSearchParams({
    documentRevision: String(documentRevision),
    waitMs: String(waitMs),
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
  documentRevision: number | null | undefined,
  slideCount: number,
  options: { enabled?: boolean; waitMs?: number } = {},
): DeckThumbnailsState {
  const enabled = options.enabled !== false && Boolean(deckId && documentRevision && slideCount > 0)
  const waitMs = options.waitMs ?? THUMBNAIL_LONG_POLL_MAX_WAIT_MS
  const [status, setStatus] = useState<ThumbnailStatus | null>(null)
  const [thumbnailUrls, setThumbnailUrls] = useState<(string | null)[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)
  // Once the API reports the renderer is disabled for a deck, skip further
  // fetches for that deck. Rapid undo/redo otherwise hammers /thumbnails during
  // preview reloads (manual-edit smoke). Accessed only from effects.
  const disabledDeckIdsRef = useRef(new Set<string>())
  // Revision URLs are immutable, but identical per-slide hashes point at the
  // same rendered pixels. Keep those URLs stable across edits so unchanged
  // thumbnail <img> elements do not reload.
  const stateKeyRef = useRef<{
    deckId: string
    documentRevision: number
    slideCount: number
  } | null>(null)
  // Mirrors thumbnailUrls so the poll loop can read the latest committed URLs
  // without re-running the effect (the effect intentionally excludes it from deps).
  const thumbnailUrlsRef = useRef<(string | null)[] | null>(null)

  useEffect(() => {
    thumbnailUrlsRef.current = thumbnailUrls
  }, [thumbnailUrls])

  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect -- one-shot long-poll thumbnail fetch with AbortController + request-id staleness guards; project has no data-fetching library (rule's documented suppression)
  useEffect(() => {
    if (!enabled || !deckId || !documentRevision) {
      return () => undefined
    }

    const previousStateKey = stateKeyRef.current
    const deckOrStructureChanged =
      previousStateKey !== null &&
      (previousStateKey.deckId !== deckId || previousStateKey.slideCount !== slideCount)
    const revisionChanged =
      previousStateKey === null ||
      previousStateKey.deckId !== deckId ||
      previousStateKey.documentRevision !== documentRevision ||
      previousStateKey.slideCount !== slideCount

    if (revisionChanged) {
      stateKeyRef.current = { deckId, documentRevision, slideCount }
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
      return () => undefined
    }

    let cancelled = false
    let cancelScheduledPoll: (() => void) | null = null
    let activeController: AbortController | null = null
    const requestId = ++requestIdRef.current

    const schedulePoll = () => {
      cancelScheduledPoll?.()
      cancelScheduledPoll = scheduleAfter(
        () => {
          cancelScheduledPoll = null
          void load()
        },
        waitMs === 0 ? PENDING_REPOLL_NO_WAIT_MS : PENDING_REPOLL_MS,
      )
    }

    const load = async () => {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      setIsLoading(true)
      let continuesPolling = false

      try {
        const payload = await fetchDeckThumbnails(
          deckId,
          documentRevision,
          controller.signal,
          waitMs,
        )

        if (cancelled || requestId !== requestIdRef.current) {
          return
        }

        if (payload.status === 'disabled') {
          disabledDeckIdsRef.current.add(deckId)
        }

        setStatus(payload.status)
        setError(payload.error ?? null)

        if (payload.status === 'ready') {
          const nextUrls = toThumbnailUrls(payload, slideCount, thumbnailUrlsRef.current)
          setThumbnailUrls(nextUrls)
          if (activeController === controller) {
            activeController = null
          }
          return
        }

        if (payload.status === 'pending') {
          // The long-poll loop keeps isLoading true while thumbnails are still
          // rendering; only the final ready/error state clears it.
          continuesPolling = true
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
      } finally {
        setIsLoading((current) =>
          cancelled || requestId !== requestIdRef.current || continuesPolling ? current : false,
        )
      }
    }

    void load()

    return () => {
      cancelled = true
      cancelScheduledPoll?.()
      activeController?.abort()
    }
  }, [deckId, enabled, slideCount, documentRevision, waitMs])

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
