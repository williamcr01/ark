import { describe, expect, it, vi } from 'vitest'

import { createPreviewSessionStore } from './preview-sessions.ts'

describe('preview session store', () => {
  it('creates and retrieves preview sessions until they expire', () => {
    const store = createPreviewSessionStore({ ttlMs: 60_000 })
    const session = store.createSession('<html><body>demo</body></html>')

    expect(session.token).toHaveLength(32)
    expect(session.editorBridge).toBe(false)
    expect(store.getSession(session.token)?.html).toContain('demo')
    expect(store.deleteSession(session.token)).toBe(true)
    expect(store.getSession(session.token)).toBeNull()
  })

  it('stores editor bridge render options with the preview session', () => {
    const store = createPreviewSessionStore({ ttlMs: 60_000 })
    const session = store.createSession('<html><body>demo</body></html>', { editorBridge: true })

    expect(store.getSession(session.token)?.editorBridge).toBe(true)
  })

  it('reuses identical html+editorBridge sessions within the ttl', () => {
    const store = createPreviewSessionStore({ ttlMs: 60_000 })
    const html = '<html><body>same deck</body></html>'
    const first = store.createSession(html, { editorBridge: true })
    const second = store.createSession(html, { editorBridge: true })
    const differentBridge = store.createSession(html, { editorBridge: false })

    expect(second.token).toBe(first.token)
    expect(second.handshake).toBe(first.handshake)
    expect(differentBridge.token).not.toBe(first.token)
  })

  it('does not share thumbnail render sessions with interactive previews', () => {
    const store = createPreviewSessionStore({ ttlMs: 60_000 })
    const html = '<html><body>same deck</body></html>'
    const interactive = store.createSession(html, { editorBridge: false })
    const thumbnail = store.createSession(html, {
      thumbnailPreview: {
        html: '<html><body>thumb</body></html>',
        runtimeMode: 'static',
        nonce: 'nonce',
      },
    })
    const thumbnailAgain = store.createSession(html, {
      thumbnailPreview: {
        html: '<html><body>thumb-2</body></html>',
        runtimeMode: 'static',
        nonce: 'nonce-2',
      },
    })

    expect(thumbnail.token).not.toBe(interactive.token)
    expect(thumbnailAgain.token).not.toBe(thumbnail.token)

    expect(store.deleteSession(thumbnail.token)).toBe(true)
    expect(store.getSession(interactive.token)?.html).toContain('same deck')
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
