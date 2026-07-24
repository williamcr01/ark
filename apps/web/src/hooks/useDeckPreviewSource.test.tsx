import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDeckPreviewSource } from './useDeckPreviewSource'

const patchResult = (html: string) =>
  ({
    deck: { html },
    patch: {
      appliedCount: 1,
      changedSlideIndexes: [0],
      changedElementIds: [],
      summary: 'test',
    },
  }) satisfies Parameters<ReturnType<typeof useDeckPreviewSource>['finishLivePatch']>[0]

describe('useDeckPreviewSource', () => {
  it('resets generation-scoped live patch state when the deck changes', () => {
    const view = renderHook(({ deckId, html }) => useDeckPreviewSource(deckId, html), {
      initialProps: { deckId: 'deck-a', html: 'A' },
    })

    expect(view.result.current.beginLivePatch('element-a')).toBe(true)
    view.rerender({ deckId: 'deck-b', html: 'B' })

    expect(view.result.current.previewHtml).toBe('B')
    expect(view.result.current.beginLivePatch('element-b')).toBe(true)
  })

  it('keeps a successful live DOM patch visible when persisted HTML arrives', () => {
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html), {
      initialProps: { html: 'before' },
    })

    expect(view.result.current.beginLivePatch('element-a')).toBe(true)
    act(() => view.result.current.finishLivePatch(patchResult('after')))
    view.rerender({ html: 'after' })

    expect(view.result.current.previewHtml).toBe('before')
    expect(view.result.current.previewReloadRevision).toBe(0)
  })

  it('reloads canonical HTML after a failed live patch', () => {
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html), {
      initialProps: { html: 'before' },
    })

    expect(view.result.current.beginLivePatch('element-a')).toBe(true)
    view.rerender({ html: 'canonical' })
    const revision = view.result.current.previewReloadRevision
    act(() => view.result.current.rollbackLivePatch())

    expect(view.result.current.previewHtml).toBe('canonical')
    expect(view.result.current.previewReloadRevision).toBeGreaterThan(revision)
  })

  it('does not keep live HTML for transient elements or overlapping patches', () => {
    const view = renderHook(() => useDeckPreviewSource('deck-a', 'before'))

    expect(view.result.current.beginLivePatch('transient-el-test')).toBe(false)
    expect(view.result.current.beginLivePatch('element-a')).toBe(true)
    expect(view.result.current.beginLivePatch('element-b')).toBe(false)
  })
})
