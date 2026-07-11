import { describe, expect, it } from 'vitest'

import { createPreviewHtmlCache, createPreviewHtmlCacheKey } from './preview-html-cache.ts'

const html = '<!DOCTYPE html><html><body><section class="slide">One</section></body></html>'

describe('preview HTML cache', () => {
  it('returns hits before TTL expiry and misses afterward', () => {
    let now = 1_000
    const cache = createPreviewHtmlCache({
      ttlMs: 100,
      now: () => now,
    })
    const key = createPreviewHtmlCacheKey({
      html,
      parentOrigin: 'http://localhost:5173',
      runtimeMode: 'static',
      editorBridge: false,
    })

    expect(cache.get(key)).toBeNull()

    cache.set(key, {
      html: '<html></html>',
      runtimeMode: 'static',
      noncePlaceholder: 'NoncePlaceholder',
    })

    expect(cache.get(key)?.html).toBe('<html></html>')

    now += 101

    expect(cache.get(key)).toBeNull()
    expect(cache.stats().size).toBe(0)
  })

  it('evicts the least-recently used entry over the max entry limit', () => {
    const cache = createPreviewHtmlCache({ maxEntries: 2 })
    const firstKey = 'first'
    const secondKey = 'second'
    const thirdKey = 'third'

    cache.set(firstKey, { html: 'first-html', runtimeMode: 'static', noncePlaceholder: null })
    cache.set(secondKey, { html: 'second-html', runtimeMode: 'static', noncePlaceholder: null })
    expect(cache.get(firstKey)?.html).toBe('first-html')
    cache.set(thirdKey, { html: 'third-html', runtimeMode: 'static', noncePlaceholder: null })

    expect(cache.get(secondKey)).toBeNull()
    expect(cache.get(firstKey)?.html).toBe('first-html')
    expect(cache.get(thirdKey)?.html).toBe('third-html')
  })

  it('discriminates keys by hash, origin, runtime, editor mode, and pipeline version', () => {
    const base = {
      html,
      parentOrigin: 'http://localhost:5173',
      runtimeMode: 'static' as const,
      editorBridge: false,
    }
    const baseKey = createPreviewHtmlCacheKey(base)

    expect(createPreviewHtmlCacheKey({ ...base, html: `${html}<!-- changed -->` })).not.toBe(
      baseKey,
    )
    expect(createPreviewHtmlCacheKey({ ...base, parentOrigin: 'http://127.0.0.1:5173' })).not.toBe(
      baseKey,
    )
    expect(createPreviewHtmlCacheKey({ ...base, runtimeMode: 'custom-js' })).not.toBe(baseKey)
    expect(createPreviewHtmlCacheKey({ ...base, editorBridge: true })).not.toBe(baseKey)
    expect(createPreviewHtmlCacheKey({ ...base, pipelineVersion: 'next-version' })).not.toBe(
      baseKey,
    )
  })
})
