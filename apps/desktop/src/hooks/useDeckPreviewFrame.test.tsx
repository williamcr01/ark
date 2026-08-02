import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/hooks/useSandboxPreview', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSandboxPreview')>(
    '@/hooks/useSandboxPreview',
  )
  return {
    ...actual,
    useSandboxPreview: () => ({
      previewUrl: 'http://localhost:5174/preview/test',
      sandboxOrigin: 'http://localhost:5174',
      sessionToken: 'test-token',
      handshake: 'test-handshake',
      isLoading: false,
      isStale: false,
      error: null,
    }),
  }
})

import { fingerprintPreviewHtml } from '@/hooks/useSandboxPreview'

import { useDeckPreviewFrame } from './useDeckPreviewFrame'

describe('fingerprintPreviewHtml', () => {
  it('changes when content changes at the same length', () => {
    const a = fingerprintPreviewHtml('aaaa')
    const b = fingerprintPreviewHtml('bbbb')
    expect(a).not.toBe(b)
    expect('aaaa'.length).toBe('bbbb'.length)
  })
})

describe('useDeckPreviewFrame sandbox keying', () => {
  it('keeps the current sandbox iframe while an updated session is pending', () => {
    const first = renderHook(({ html }) => useDeckPreviewFrame(html, true), {
      initialProps: { html: '<section class="slide">AAAA</section>' },
    })

    const firstKey = first.result.current.iframeKey
    expect(firstKey).toContain('sandbox:')
    expect(first.result.current.handshake).toBeTruthy()

    first.rerender({ html: '<section class="slide">BBBB</section>' })

    expect(first.result.current.iframeKey).toBe(firstKey)
    expect(first.result.current.iframeKey).toContain('sandbox:')
  })

  it('keeps iframeKey stable across same-HTML rerenders', () => {
    const view = renderHook(() => useDeckPreviewFrame('<section class="slide">Hi</section>', true))

    const viewKey = view.result.current.iframeKey
    const viewHandshake = view.result.current.handshake
    view.rerender()
    expect(view.result.current.iframeKey).toBe(viewKey)
    expect(view.result.current.handshake).toBe(viewHandshake)
  })

  it('changes iframeKey when the same source must be reloaded', () => {
    const view = renderHook(
      ({ reloadRevision }) =>
        useDeckPreviewFrame('<section class="slide">Hi</section>', true, reloadRevision),
      { initialProps: { reloadRevision: 0 } },
    )

    const viewKey = view.result.current.iframeKey
    view.rerender({ reloadRevision: 1 })

    expect(view.result.current.iframeKey).not.toBe(viewKey)
  })

  it('uses the sandbox host for interactive previews', () => {
    const view = renderHook(() => useDeckPreviewFrame('<section class="slide">Hi</section>', true))

    expect(view.result.current.iframeSrc).toBe('http://localhost:5174/preview/test')
  })
})
