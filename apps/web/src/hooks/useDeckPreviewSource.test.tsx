import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

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

  it('allows live HTML for transient elements but not overlapping patches', () => {
    const view = renderHook(() => useDeckPreviewSource('deck-a', 'before'))

    expect(view.result.current.beginLivePatch('transient-el-test')).toBe(true)
    expect(view.result.current.beginLivePatch('element-b')).toBe(false)
  })

  it('patches the loaded preview instead of reloading it for slide-only edits', () => {
    const onSlidePatch = vi.fn().mockReturnValue(true)
    const edited = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html, { onSlidePatch }), {
      initialProps: { html: plainCssDeck },
    })

    view.rerender({ html: edited })

    expect(onSlidePatch).toHaveBeenCalledTimes(1)
    expect(onSlidePatch.mock.calls[0]![0].slideCount).toBe(3)
    expect(onSlidePatch.mock.calls[0]![0].operations).toEqual([
      { op: 'remove', index: 1 },
      { op: 'insert', index: 1, html: expect.stringContaining('Metrics that mattered') },
    ])
    // The iframe keeps rendering the session it already loaded.
    expect(view.result.current.previewHtml).toBe(plainCssDeck)
    expect(view.result.current.previewReloadRevision).toBe(0)
  })

  it('reloads when the change reaches outside the slides', () => {
    const onSlidePatch = vi.fn().mockReturnValue(true)
    const restyled = plainCssDeck.replace('background: white;', 'background: black;')
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html, { onSlidePatch }), {
      initialProps: { html: plainCssDeck },
    })

    view.rerender({ html: restyled })

    expect(onSlidePatch).not.toHaveBeenCalled()
    expect(view.result.current.previewHtml).toBe(restyled)
  })

  it('reloads when the preview cannot accept the patch', () => {
    const onSlidePatch = vi.fn().mockReturnValue(false)
    const edited = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html, { onSlidePatch }), {
      initialProps: { html: plainCssDeck },
    })

    view.rerender({ html: edited })

    expect(onSlidePatch).toHaveBeenCalledTimes(1)
    expect(view.result.current.previewHtml).toBe(edited)
  })

  it('patches again after an earlier patch, diffing against what the frame shows', () => {
    const onSlidePatch = vi.fn().mockReturnValue(true)
    const once = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const twice = once.replace('Next decisions', 'Next steps')
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html, { onSlidePatch }), {
      initialProps: { html: plainCssDeck },
    })

    view.rerender({ html: once })
    view.rerender({ html: twice })

    expect(onSlidePatch).toHaveBeenCalledTimes(2)
    expect(onSlidePatch.mock.calls[1]![0].operations).toEqual([
      { op: 'remove', index: 2 },
      { op: 'insert', index: 2, html: expect.stringContaining('Next steps') },
    ])
    expect(view.result.current.previewReloadRevision).toBe(0)
  })

  it('does not patch a frame whose DOM the editor mutated out from under it', () => {
    const onSlidePatch = vi.fn().mockReturnValue(true)
    const edited = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const view = renderHook(({ html }) => useDeckPreviewSource('deck-a', html, { onSlidePatch }), {
      initialProps: { html: plainCssDeck },
    })

    expect(view.result.current.beginLivePatch('element-a')).toBe(true)
    view.rerender({ html: edited })

    expect(onSlidePatch).not.toHaveBeenCalled()
  })

  it('ignores stale live-patch completions after a deck switch', () => {
    const view = renderHook(({ deckId, html }) => useDeckPreviewSource(deckId, html), {
      initialProps: { deckId: 'deck-a', html: 'A' },
    })
    const finishStalePatch = view.result.current.finishLivePatch
    const staleRollback = view.result.current.rollbackLivePatch
    expect(view.result.current.beginLivePatch('element-a')).toBe(true)

    view.rerender({ deckId: 'deck-b', html: 'B' })
    const revision = view.result.current.previewReloadRevision
    act(() => {
      finishStalePatch(undefined)
      staleRollback()
    })

    expect(view.result.current.previewHtml).toBe('B')
    expect(view.result.current.previewReloadRevision).toBe(revision)
  })
})
