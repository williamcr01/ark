import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'

import { createLogger, type Logger } from '@ark/telemetry/logger.ts'

export type ThumbnailPreviewCache = {
  html: string
  runtimeMode: 'static' | 'reveal' | 'custom-js'
  nonce: string | null
}

export type PreviewSession = {
  token: string
  /** Correlates the render generation and authenticates the editor channel. */
  handshake: string
  html: string
  editorBridge: boolean
  /**
   * Optional prebuilt thumbnail iframe document. When set, the thumbnail render
   * host serves this instead of synchronously rebuilding preview HTML on GET.
   */
  thumbnailPreview?: ThumbnailPreviewCache
  createdAt: number
  /** Updated on create, reuse, and getSession — drives LRU eviction. */
  lastAccessedAt: number
  expiresAt: number
}

export class PreviewSessionCapacityError extends Error {
  readonly code = 'preview_session_capacity' as const

  constructor(message: string) {
    super(message)
    this.name = 'PreviewSessionCapacityError'
  }
}

export type PreviewSessionOptions = {
  editorBridge?: boolean
  thumbnailPreview?: ThumbnailPreviewCache
}

export type PreviewSessionStore = {
  createSession: (html: string, options?: PreviewSessionOptions) => PreviewSession
  getSession: (token: string) => PreviewSession | null
  deleteSession: (token: string) => boolean
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

/** Default session count cap — well above normal editor + thumbnail traffic. */
export const DEFAULT_PREVIEW_SESSION_MAX_SESSIONS = 500

/** Default total HTML byte cap across all live sessions (~64 MiB). */
export const DEFAULT_PREVIEW_SESSION_MAX_TOTAL_HTML_BYTES = 64 * 1024 * 1024

/** Bounded extra slots reserved for in-flight thumbnail renders. */
export const DEFAULT_PREVIEW_SESSION_THUMBNAIL_HEADROOM = 16

export type PreviewSessionStoreOptions = {
  ttlMs?: number
  maxSessions?: number
  maxTotalHtmlBytes?: number
  logger?: Logger
}

function previewSessionContentKey(html: string, editorBridge: boolean) {
  const hash = createHash('sha256').update(html).digest('hex')
  return `${editorBridge ? '1' : '0'}:${hash}`
}

function previewSessionTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex').slice(0, 12)
}

function sessionHtmlBytes(session: Pick<PreviewSession, 'html' | 'thumbnailPreview'>): number {
  let bytes = Buffer.byteLength(session.html, 'utf8')
  if (session.thumbnailPreview) {
    bytes += Buffer.byteLength(session.thumbnailPreview.html, 'utf8')
  }
  return bytes
}

type PreviewSessionRuntime = {
  ttlMs: number
  maxSessions: number
  maxTotalHtmlBytes: number
  logger: Logger
  sessions: Map<string, PreviewSession>
  tokensByContentKey: Map<string, string>
  totalHtmlBytes: { current: number }
}

function removeContentKeyIfOwned(runtime: PreviewSessionRuntime, session: PreviewSession) {
  if (session.thumbnailPreview) {
    return
  }

  const contentKey = previewSessionContentKey(session.html, session.editorBridge)
  if (runtime.tokensByContentKey.get(contentKey) === session.token) {
    runtime.tokensByContentKey.delete(contentKey)
  }
}

function removePreviewSession(runtime: PreviewSessionRuntime, session: PreviewSession) {
  if (!runtime.sessions.delete(session.token)) {
    return false
  }

  runtime.totalHtmlBytes.current = Math.max(
    0,
    runtime.totalHtmlBytes.current - sessionHtmlBytes(session),
  )
  removeContentKeyIfOwned(runtime, session)
  return true
}

function purgeExpiredPreviewSessions(runtime: PreviewSessionRuntime) {
  const now = Date.now()

  for (const session of runtime.sessions.values()) {
    if (session.expiresAt <= now) {
      removePreviewSession(runtime, session)
    }
  }
}

function touchSessionAccess(session: PreviewSession, now = Date.now()) {
  session.lastAccessedAt = now
}

function refreshSessionTtl(session: PreviewSession, ttlMs: number, now = Date.now()) {
  touchSessionAccess(session, now)
  session.expiresAt = now + ttlMs
}

function findLeastRecentlyUsedEvictableSession(
  sessions: Map<string, PreviewSession>,
): PreviewSession | null {
  let lru: PreviewSession | null = null

  for (const session of sessions.values()) {
    if (session.thumbnailPreview) {
      continue
    }

    if (!lru || session.lastAccessedAt < lru.lastAccessedAt) {
      lru = session
    }
  }

  return lru
}

function evictUntilUnderCap(
  runtime: PreviewSessionRuntime,
  incomingBytes: number,
  options?: { allowThumbnailOverflow?: boolean },
) {
  const thumbnailSessionCeiling = runtime.maxSessions + DEFAULT_PREVIEW_SESSION_THUMBNAIL_HEADROOM

  while (runtime.sessions.size > 0) {
    const overSessionCap = runtime.sessions.size >= runtime.maxSessions
    const overByteCap = runtime.totalHtmlBytes.current + incomingBytes > runtime.maxTotalHtmlBytes

    if (!overSessionCap && !overByteCap) {
      return true
    }

    const victim = findLeastRecentlyUsedEvictableSession(runtime.sessions)
    if (!victim) {
      return (
        options?.allowThumbnailOverflow === true &&
        !overByteCap &&
        runtime.sessions.size < thumbnailSessionCeiling
      )
    }

    const reason = overSessionCap ? 'max_sessions' : 'max_total_html_bytes'
    removePreviewSession(runtime, victim)
    runtime.logger.warn('preview.session.evicted', {
      reason,
      tokenHash: previewSessionTokenHash(victim.token),
      htmlBytes: sessionHtmlBytes(victim),
      sessionCount: runtime.sessions.size,
      totalHtmlBytes: runtime.totalHtmlBytes.current,
      maxSessions: runtime.maxSessions,
      maxTotalHtmlBytes: runtime.maxTotalHtmlBytes,
    })
  }

  return incomingBytes <= runtime.maxTotalHtmlBytes
}

function insertPreviewSession(
  runtime: PreviewSessionRuntime,
  html: string,
  sessionOptions: PreviewSessionOptions = {},
): PreviewSession {
  purgeExpiredPreviewSessions(runtime)

  const editorBridge = sessionOptions.editorBridge === true
  const isThumbnailSession = Boolean(sessionOptions.thumbnailPreview)

  if (!isThumbnailSession) {
    const contentKey = previewSessionContentKey(html, editorBridge)
    const existingToken = runtime.tokensByContentKey.get(contentKey)

    if (existingToken) {
      const existing = runtime.sessions.get(existingToken)

      if (existing && !existing.thumbnailPreview && existing.expiresAt > Date.now()) {
        refreshSessionTtl(existing, runtime.ttlMs)
        return existing
      }

      runtime.tokensByContentKey.delete(contentKey)
    }
  }

  const now = Date.now()
  const session: PreviewSession = {
    token: nanoid(32),
    handshake: nanoid(24),
    html,
    editorBridge,
    ...(sessionOptions.thumbnailPreview
      ? { thumbnailPreview: sessionOptions.thumbnailPreview }
      : {}),
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + runtime.ttlMs,
  }

  const incomingBytes = sessionHtmlBytes(session)

  if (incomingBytes > runtime.maxTotalHtmlBytes) {
    throw new PreviewSessionCapacityError(
      `Preview session HTML (${incomingBytes} bytes) exceeds the store cap (${runtime.maxTotalHtmlBytes} bytes).`,
    )
  }

  const hasRoom = evictUntilUnderCap(runtime, incomingBytes, {
    allowThumbnailOverflow: isThumbnailSession,
  })

  if (!hasRoom) {
    throw new PreviewSessionCapacityError(
      'Preview session store is at capacity; retry after other sessions expire.',
    )
  }

  runtime.sessions.set(session.token, session)
  runtime.totalHtmlBytes.current += incomingBytes

  if (!isThumbnailSession) {
    runtime.tokensByContentKey.set(previewSessionContentKey(html, editorBridge), session.token)
  }

  return session
}

function lookupPreviewSession(
  runtime: PreviewSessionRuntime,
  token: string,
): PreviewSession | null {
  purgeExpiredPreviewSessions(runtime)

  const session = runtime.sessions.get(token)

  if (!session) {
    return null
  }

  if (session.expiresAt <= Date.now()) {
    removePreviewSession(runtime, session)
    return null
  }

  touchSessionAccess(session)
  return session
}

export function createPreviewSessionStore(
  options: PreviewSessionStoreOptions = {},
): PreviewSessionStore {
  const runtime: PreviewSessionRuntime = {
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    maxSessions: options.maxSessions ?? DEFAULT_PREVIEW_SESSION_MAX_SESSIONS,
    maxTotalHtmlBytes: options.maxTotalHtmlBytes ?? DEFAULT_PREVIEW_SESSION_MAX_TOTAL_HTML_BYTES,
    logger: options.logger ?? createLogger({ service: 'ark-api' }),
    sessions: new Map<string, PreviewSession>(),
    tokensByContentKey: new Map<string, string>(),
    totalHtmlBytes: { current: 0 },
  }

  return {
    createSession(html, sessionOptions = {}) {
      return insertPreviewSession(runtime, html, sessionOptions)
    },

    getSession(token) {
      return lookupPreviewSession(runtime, token)
    },

    deleteSession(token) {
      const session = runtime.sessions.get(token)

      if (!session) {
        return false
      }

      return removePreviewSession(runtime, session)
    },
  }
}

export const defaultPreviewSessionStore = createPreviewSessionStore()
