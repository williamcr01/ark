import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { fingerprintPreviewHtml } from '@/hooks/useSandboxPreview'

vi.mock('@/lib/deck-preview', async () => {
  const actual = await vi.importActual<typeof import('@/lib/deck-preview')>('@/lib/deck-preview')
  return {
    ...actual,
    useSrcDocPreviewFallback: () => true,
    getPreviewHtml: (html: string, options: { handshake?: string; editorBridge?: boolean } = {}) =>
      `<!--preview:${options.handshake ?? ''}:${options.editorBridge ? 'edit' : 'view'}-->${html}`,
  }
})

import { useDeckPreviewFrame } from './useDeckPreviewFrame'

describe('fingerprintPreviewHtml', () => {
  it('changes when content changes at the same length', () => {
    const a = fingerprintPreviewHtml('aaaa')
    const b = fingerprintPreviewHtml('bbbb')
    expect(a).not.toBe(b)
    expect('aaaa'.length).toBe('bbbb'.length)
  })
})

describe('useDeckPreviewFrame srcDoc keying', () => {
  it('changes iframeKey for equal-length HTML edits', () => {
    const first = renderHook(({ html }) => useDeckPreviewFrame(html, true), {
      initialProps: { html: '<section class="slide">AAAA</section>' },
    })

    const firstKey = first.result.current.iframeKey
    expect(firstKey).toContain('srcdoc:')
    expect(first.result.current.handshake).toBeTruthy()

    first.rerender({ html: '<section class="slide">BBBB</section>' })

    expect(first.result.current.iframeKey).not.toBe(firstKey)
    expect(first.result.current.iframeKey).toContain('srcdoc:')
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

  it('always injects the dormant editor runtime for interactive previews', () => {
    const view = renderHook(() => useDeckPreviewFrame('<section class="slide">Hi</section>', true))

    expect(view.result.current.iframeSrcDoc).toContain(':edit')
    expect(view.result.current.iframeSrcDoc).not.toContain(':view')
  })
})
