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

export function createPreviewSessionStore(options: { ttlMs?: number } = {}): PreviewSessionStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const sessions = new Map<string, PreviewSession>()

  const purgeExpired = () => {
    const now = Date.now()

    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(token)
      }
    }
  }

  return {
    createSession(html, options = {}) {
      purgeExpired()

      const now = Date.now()
      const token = nanoid(32)
      const handshake = nanoid(24)
      const session: PreviewSession = {
        token,
        handshake,
        html,
        editorBridge: options.editorBridge === true,
        ...(options.thumbnailPreview ? { thumbnailPreview: options.thumbnailPreview } : {}),
        createdAt: now,
        expiresAt: now + ttlMs,
      }

      sessions.set(token, session)

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
        return null
      }

      return session
    },

    deleteSession(token) {
      return sessions.delete(token)
    },
  }
}

export const defaultPreviewSessionStore = createPreviewSessionStore()
