import { describe, expect, it, vi } from 'vitest'

import { createPreviewSessionStore } from './preview-sessions.ts'

describe('preview session store', () => {
  it('creates and retrieves preview sessions until they expire', () => {
    const store = createPreviewSessionStore({ ttlMs: 60_000 })
    const session = store.createSession('<html><body>demo</body></html>')

    expect(session.token).toHaveLength(32)
    expect(store.getSession(session.token)?.html).toContain('demo')
    expect(store.deleteSession(session.token)).toBe(true)
    expect(store.getSession(session.token)).toBeNull()
  })

  it('expires preview sessions after the configured ttl', () => {
    vi.useFakeTimers()

    try {
      const store = createPreviewSessionStore({ ttlMs: 1_000 })
      const session = store.createSession('<html></html>')

      vi.advanceTimersByTime(1_001)

      expect(store.getSession(session.token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
