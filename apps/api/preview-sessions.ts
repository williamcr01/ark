import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'

import { createLogger, type Logger } from './observability/logger.ts'

export type ThumbnailPreviewCache = {
  html: string
  runtimeMode: 'static' | 'reveal' | 'custom-js'
  nonce: string | null
}

export type PreviewSession = {
  token: string
  /** Correlates the render generation for the bridge handshake (not a secret). */
  handshake: string
  html: string
  editorBridge: boolean
  /**
   * Optional prebuilt thumbnail iframe document. When set, the thumbnail render
   * host serves this instead of synchronously rebuilding preview HTML on GET.
   */
  thumbnailPreview?: ThumbnailPreviewCache
  createdAt: number
  expiresAt: number
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

function sessionHtmlBytes(session: Pick<PreviewSession, 'html' | 'thumbnailPreview'>): number {
  let bytes = Buffer.byteLength(session.html, 'utf8')
  if (session.thumbnailPreview) {
    bytes += Buffer.byteLength(session.thumbnailPreview.html, 'utf8')
  }
  return bytes
}

export function createPreviewSessionStore(
  options: PreviewSessionStoreOptions = {},
): PreviewSessionStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const maxSessions = options.maxSessions ?? DEFAULT_PREVIEW_SESSION_MAX_SESSIONS
  const maxTotalHtmlBytes =
    options.maxTotalHtmlBytes ?? DEFAULT_PREVIEW_SESSION_MAX_TOTAL_HTML_BYTES
  const logger = options.logger ?? createLogger({ service: 'ark-api' })
  const sessions = new Map<string, PreviewSession>()
  /**
   * Reuse identical interactive (html, editorBridge) sessions within TTL.
   * Thumbnail render sessions are never deduped — the renderer deletes its
   * token in `finally` and must not invalidate shared interactive previews.
   */
  const tokensByContentKey = new Map<string, string>()
  let totalHtmlBytes = 0

  const removeContentKeyIfOwned = (session: PreviewSession) => {
    if (session.thumbnailPreview) {
      return
    }

    const contentKey = previewSessionContentKey(session.html, session.editorBridge)
    if (tokensByContentKey.get(contentKey) === session.token) {
      tokensByContentKey.delete(contentKey)
    }
  }

  const removeSession = (session: PreviewSession) => {
    if (!sessions.delete(session.token)) {
      return false
    }

    totalHtmlBytes = Math.max(0, totalHtmlBytes - sessionHtmlBytes(session))
    removeContentKeyIfOwned(session)
    return true
  }

  const purgeExpired = () => {
    const now = Date.now()

    for (const session of sessions.values()) {
      if (session.expiresAt <= now) {
        removeSession(session)
      }
    }
  }

  const findOldestSession = (): PreviewSession | null => {
    let oldest: PreviewSession | null = null

    for (const session of sessions.values()) {
      if (!oldest || session.createdAt < oldest.createdAt) {
        oldest = session
      }
    }

    return oldest
  }

  const evictUntilUnderCap = (incomingBytes: number) => {
    while (sessions.size > 0) {
      const overSessionCap = sessions.size >= maxSessions
      const overByteCap = totalHtmlBytes + incomingBytes > maxTotalHtmlBytes

      if (!overSessionCap && !overByteCap) {
        return
      }

      const oldest = findOldestSession()
      if (!oldest) {
        return
      }

      const reason = overSessionCap ? 'max_sessions' : 'max_total_html_bytes'
      removeSession(oldest)
      logger.warn('preview.session.evicted', {
        reason,
        token: oldest.token,
        htmlBytes: sessionHtmlBytes(oldest),
        sessionCount: sessions.size,
        totalHtmlBytes,
        maxSessions,
        maxTotalHtmlBytes,
      })
    }
  }

  return {
    createSession(html, sessionOptions = {}) {
      purgeExpired()

      const editorBridge = sessionOptions.editorBridge === true
      const isThumbnailSession = Boolean(sessionOptions.thumbnailPreview)

      // Thumbnail sessions own a unique token lifecycle (create → Chromium GET
      // → delete in renderer finally). Never share them with interactive
      // previews or other thumbnail renders.
      if (!isThumbnailSession) {
        const contentKey = previewSessionContentKey(html, editorBridge)
        const existingToken = tokensByContentKey.get(contentKey)

        if (existingToken) {
          const existing = sessions.get(existingToken)

          if (existing && !existing.thumbnailPreview && existing.expiresAt > Date.now()) {
            existing.expiresAt = Date.now() + ttlMs
            return existing
          }

          tokensByContentKey.delete(contentKey)
        }
      }

      const now = Date.now()
      const token = nanoid(32)
      const handshake = nanoid(24)
      const session: PreviewSession = {
        token,
        handshake,
        html,
        editorBridge,
        ...(sessionOptions.thumbnailPreview
          ? { thumbnailPreview: sessionOptions.thumbnailPreview }
          : {}),
        createdAt: now,
        expiresAt: now + ttlMs,
      }

      evictUntilUnderCap(sessionHtmlBytes(session))

      sessions.set(token, session)
      totalHtmlBytes += sessionHtmlBytes(session)

      if (!isThumbnailSession) {
        tokensByContentKey.set(previewSessionContentKey(html, editorBridge), token)
      }

      return session
    },

    getSession(token) {
      purgeExpired()

      const session = sessions.get(token)

      if (!session) {
        return null
      }

      if (session.expiresAt <= Date.now()) {
        removeSession(session)
        return null
      }

      return session
    },

    deleteSession(token) {
      const session = sessions.get(token)

      if (!session) {
        return false
      }

      return removeSession(session)
    },
  }
}

export const defaultPreviewSessionStore = createPreviewSessionStore()
