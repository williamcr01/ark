import { nanoid } from 'nanoid'

export type PreviewSession = {
  token: string
  html: string
  editorBridge: boolean
  createdAt: number
  expiresAt: number
}

export type PreviewSessionOptions = {
  editorBridge?: boolean
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
      const session: PreviewSession = {
        token,
        html,
        editorBridge: options.editorBridge === true,
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
