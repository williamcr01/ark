import { describe, expect, it, vi } from 'vitest'

import { createLogger, type StructuredLogEntry } from './observability/logger.ts'
import { createPreviewSessionStore, PreviewSessionCapacityError } from './preview-sessions.ts'

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

  it('evicts least recently used sessions when maxSessions is exceeded', () => {
    vi.useFakeTimers()

    try {
      const entries: StructuredLogEntry[] = []
      const logger = createLogger({
        write: (entry) => {
          entries.push(entry)
        },
      })
      const store = createPreviewSessionStore({
        ttlMs: 60_000,
        maxSessions: 2,
        maxTotalHtmlBytes: 10_000_000,
        logger,
      })

      const first = store.createSession('<html>one</html>')
      vi.advanceTimersByTime(10)
      const second = store.createSession('<html>two</html>')
      vi.advanceTimersByTime(10)
      store.getSession(first.token)
      vi.advanceTimersByTime(10)
      const third = store.createSession('<html>three</html>')

      expect(store.getSession(second.token)).toBeNull()
      expect(store.getSession(first.token)?.html).toContain('one')
      expect(store.getSession(third.token)?.html).toContain('three')

      const eviction = entries.find((entry) => entry.event === 'preview.session.evicted')
      expect(eviction?.level).toBe('warn')
      expect(eviction?.fields).toMatchObject({
        reason: 'max_sessions',
        token: second.token,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('evicts oldest sessions when maxTotalHtmlBytes is exceeded', () => {
    vi.useFakeTimers()

    try {
      const entries: StructuredLogEntry[] = []
      const logger = createLogger({
        write: (entry) => {
          entries.push(entry)
        },
      })
      const small = 'x'.repeat(80)
      const large = 'y'.repeat(200)
      const store = createPreviewSessionStore({
        ttlMs: 60_000,
        maxSessions: 100,
        maxTotalHtmlBytes: 250,
        logger,
      })

      const first = store.createSession(`<html>${small}</html>`)
      vi.advanceTimersByTime(10)
      const second = store.createSession(`<html>${small}-2</html>`)
      vi.advanceTimersByTime(10)
      // Large payload cannot fit alongside either prior session, so both are
      // evicted oldest-first before the new session is stored.
      const third = store.createSession(`<html>${large}</html>`)

      expect(store.getSession(first.token)).toBeNull()
      expect(store.getSession(second.token)).toBeNull()
      expect(store.getSession(third.token)?.html).toContain(large)

      const evictions = entries.filter((entry) => entry.event === 'preview.session.evicted')
      expect(evictions).toHaveLength(2)
      expect(evictions.every((entry) => entry.fields?.reason === 'max_total_html_bytes')).toBe(true)
      expect(evictions[0]?.fields?.token).toBe(first.token)
      expect(evictions[1]?.fields?.token).toBe(second.token)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still reuses identical sessions under a tight maxSessions cap', () => {
    const store = createPreviewSessionStore({
      ttlMs: 60_000,
      maxSessions: 1,
      maxTotalHtmlBytes: 10_000_000,
    })
    const html = '<html><body>reuse me</body></html>'
    const first = store.createSession(html)
    const second = store.createSession(html)

    expect(second.token).toBe(first.token)
    expect(store.getSession(first.token)?.html).toContain('reuse me')
  })

  it('does not evict in-flight thumbnail sessions under store pressure', () => {
    const store = createPreviewSessionStore({
      ttlMs: 60_000,
      maxSessions: 2,
      maxTotalHtmlBytes: 10_000_000,
    })
    const html = '<html><body>deck</body></html>'

    store.createSession('<html>one</html>')
    store.createSession('<html>two</html>')
    const thumbnail = store.createSession(html, {
      thumbnailPreview: {
        html: '<html><body>thumb</body></html>',
        runtimeMode: 'static',
        nonce: 'nonce',
      },
    })

    expect(store.getSession(thumbnail.token)?.thumbnailPreview?.nonce).toBe('nonce')

    store.createSession('<html>three</html>')

    expect(store.getSession(thumbnail.token)?.thumbnailPreview?.nonce).toBe('nonce')
  })

  it('rejects a single session larger than maxTotalHtmlBytes', () => {
    const store = createPreviewSessionStore({
      ttlMs: 60_000,
      maxSessions: 10,
      maxTotalHtmlBytes: 250,
    })
    const oversized = 'x'.repeat(300)

    expect(() => store.createSession(`<html>${oversized}</html>`)).toThrow(
      PreviewSessionCapacityError,
    )
  })

  it('reuses identical sessions by bumping lastAccessedAt so they survive eviction', () => {
    vi.useFakeTimers()

    try {
      const store = createPreviewSessionStore({
        ttlMs: 60_000,
        maxSessions: 2,
        maxTotalHtmlBytes: 10_000_000,
      })
      const sharedHtml = '<html><body>active deck</body></html>'

      const active = store.createSession(sharedHtml)
      vi.advanceTimersByTime(10)
      store.createSession('<html>idle</html>')
      vi.advanceTimersByTime(10)
      store.createSession(sharedHtml)
      vi.advanceTimersByTime(10)
      store.createSession('<html>newest</html>')

      expect(store.getSession(active.token)?.html).toContain('active deck')
    } finally {
      vi.useRealTimers()
    }
  })
})
