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

type ThumbnailPollSetters = {
  setError: (error: string | null) => void
  setIsLoading: (value: boolean | ((current: boolean) => boolean)) => void
  setStatus: (status: ThumbnailStatus | null) => void
  setThumbnailUrls: (urls: (string | null)[] | null) => void
}

function syncThumbnailRequestKey(
  stateKeyRef: {
    current: { deckId: string; documentRevision: number; slideCount: number } | null
  },
  deckId: string,
  documentRevision: number,
  slideCount: number,
  setters: ThumbnailPollSetters,
) {
  const previousStateKey = stateKeyRef.current
  const deckOrStructureChanged =
    previousStateKey !== null &&
    (previousStateKey.deckId !== deckId || previousStateKey.slideCount !== slideCount)
  const revisionChanged =
    previousStateKey === null ||
    previousStateKey.deckId !== deckId ||
    previousStateKey.documentRevision !== documentRevision ||
    previousStateKey.slideCount !== slideCount

  if (!revisionChanged) {
    return
  }

  stateKeyRef.current = { deckId, documentRevision, slideCount }
  setters.setStatus(null)
  setters.setError(null)

  if (deckOrStructureChanged) {
    setters.setThumbnailUrls(null)
  }
}

function applyThumbnailPayload(
  payload: DeckThumbnailsResponse,
  options: {
    controller: AbortController
    deckId: string
    disabledDeckIds: Set<string>
    session: { activeController: AbortController | null }
    setters: ThumbnailPollSetters
    slideCount: number
    thumbnailUrlsRef: { current: (string | null)[] | null }
  },
) {
  const { controller, deckId, disabledDeckIds, session, setters, slideCount, thumbnailUrlsRef } =
    options

  if (payload.status === 'disabled') {
    disabledDeckIds.add(deckId)
  }

  setters.setStatus(payload.status)
  setters.setError(payload.error ?? null)

  if (payload.status === 'ready') {
    setters.setThumbnailUrls(toThumbnailUrls(payload, slideCount, thumbnailUrlsRef.current))
    if (session.activeController === controller) {
      session.activeController = null
    }
    return 'done' as const
  }

  if (payload.status === 'pending') {
    if (session.activeController === controller) {
      session.activeController = null
    }
    return 'pending' as const
  }

  setters.setThumbnailUrls(null)
  if (session.activeController === controller) {
    session.activeController = null
  }
  return 'done' as const
}

function createThumbnailPollSession(options: {
  deckId: string
  disabledDeckIds: Set<string>
  documentRevision: number
  requestId: number
  requestIdRef: { current: number }
  setters: ThumbnailPollSetters
  slideCount: number
  thumbnailUrlsRef: { current: (string | null)[] | null }
  waitMs: number
}) {
  const {
    deckId,
    disabledDeckIds,
    documentRevision,
    requestId,
    requestIdRef,
    setters,
    slideCount,
    thumbnailUrlsRef,
    waitMs,
  } = options
  let cancelled = false
  let cancelScheduledPoll: (() => void) | null = null
  const session = { activeController: null as AbortController | null }
  const isCurrent = () => !cancelled && requestId === requestIdRef.current

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
    session.activeController?.abort()
    const controller = new AbortController()
    session.activeController = controller
    setters.setIsLoading(true)
    let continuesPolling = false

    try {
      const payload = await fetchDeckThumbnails(deckId, documentRevision, controller.signal, waitMs)
      if (!isCurrent()) return

      const outcome = applyThumbnailPayload(payload, {
        controller,
        deckId,
        disabledDeckIds,
        session,
        setters,
        slideCount,
        thumbnailUrlsRef,
      })

      if (outcome === 'pending') {
        // The long-poll loop keeps isLoading true while thumbnails are still
        // rendering; only the final ready/error state clears it.
        continuesPolling = true
        schedulePoll()
      }
    } catch (loadError) {
      if (!isCurrent()) return
      if (loadError instanceof Error && loadError.name === 'AbortError') return

      setters.setStatus(null)
      setters.setThumbnailUrls(null)
      setters.setError(
        loadError instanceof Error ? loadError.message : 'Could not load deck thumbnails.',
      )
    } finally {
      setters.setIsLoading((current) => (!isCurrent() || continuesPolling ? current : false))
    }
  }

  return {
    start: () => {
      void load()
    },
    stop: () => {
      cancelled = true
      cancelScheduledPoll?.()
      session.activeController?.abort()
    },
  }
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

    const setters = { setError, setIsLoading, setStatus, setThumbnailUrls }
    syncThumbnailRequestKey(stateKeyRef, deckId, documentRevision, slideCount, setters)

    if (disabledDeckIdsRef.current.has(deckId)) {
      setStatus('disabled')
      setThumbnailUrls(null)
      setError(null)
      setIsLoading(false)
      return () => undefined
    }

    const poll = createThumbnailPollSession({
      deckId,
      disabledDeckIds: disabledDeckIdsRef.current,
      documentRevision,
      requestId: ++requestIdRef.current,
      requestIdRef,
      setters,
      slideCount,
      thumbnailUrlsRef,
      waitMs,
    })
    poll.start()
    return () => poll.stop()
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
