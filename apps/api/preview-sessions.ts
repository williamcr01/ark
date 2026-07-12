import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'

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

function previewSessionContentKey(html: string, editorBridge: boolean) {
  const hash = createHash('sha256').update(html).digest('hex')
  return `${editorBridge ? '1' : '0'}:${hash}`
}

export function createPreviewSessionStore(options: { ttlMs?: number } = {}): PreviewSessionStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const sessions = new Map<string, PreviewSession>()
  /** Reuse identical (html, editorBridge) sessions within TTL to skip POST work. */
  const tokensByContentKey = new Map<string, string>()

  const purgeExpired = () => {
    const now = Date.now()

    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(token)
        const contentKey = previewSessionContentKey(session.html, session.editorBridge)
        if (tokensByContentKey.get(contentKey) === token) {
          tokensByContentKey.delete(contentKey)
        }
      }
    }
  }

  return {
    createSession(html, options = {}) {
      purgeExpired()

      const editorBridge = options.editorBridge === true
      const contentKey = previewSessionContentKey(html, editorBridge)
      const existingToken = tokensByContentKey.get(contentKey)

      if (existingToken) {
        const existing = sessions.get(existingToken)

        if (existing && existing.expiresAt > Date.now()) {
          existing.expiresAt = Date.now() + ttlMs
          if (options.thumbnailPreview && !existing.thumbnailPreview) {
            existing.thumbnailPreview = options.thumbnailPreview
          }
          return existing
        }

        tokensByContentKey.delete(contentKey)
      }

      const now = Date.now()
      const token = nanoid(32)
      const handshake = nanoid(24)
      const session: PreviewSession = {
        token,
        handshake,
        html,
        editorBridge,
        ...(options.thumbnailPreview ? { thumbnailPreview: options.thumbnailPreview } : {}),
        createdAt: now,
        expiresAt: now + ttlMs,
      }

      sessions.set(token, session)
      tokensByContentKey.set(contentKey, token)

      return session
    },

    getSession(token) {
      purgeExpired()

      const session = sessions.get(token)

      if (!session) {
        return null
      }

      if (session.expiresAt <= Date.now()) {
        sessions.delete(token)
        const contentKey = previewSessionContentKey(session.html, session.editorBridge)
        if (tokensByContentKey.get(contentKey) === token) {
          tokensByContentKey.delete(contentKey)
        }
        return null
      }

      return session
    },

    deleteSession(token) {
      const session = sessions.get(token)

      if (!session) {
        return false
      }

      sessions.delete(token)
      const contentKey = previewSessionContentKey(session.html, session.editorBridge)
      if (tokensByContentKey.get(contentKey) === token) {
        tokensByContentKey.delete(contentKey)
      }
      return true
    },
  }
}

export const defaultPreviewSessionStore = createPreviewSessionStore()
