import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDeckThumbnails } from './useDeckThumbnails'

describe('useDeckThumbnails', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns null urls for unsaved decks', () => {
    const { result } = renderHook(() => useDeckThumbnails(null, null, 3))
    expect(result.current.thumbnailUrls).toBeNull()
    expect(result.current.status).toBeNull()
  })

  it('does not fetch thumbnails when disabled by the caller', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useDeckThumbnails(
        'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        2,
        { enabled: false },
      ),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBeNull()
    expect(result.current.thumbnailUrls).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls while pending and then exposes ready urls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'pending', slides: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ready',
            slides: [
              { index: 0, url: '/api/decks/d/thumbnails/v/0.png?hash=abc' },
              { index: 1, url: '/api/decks/d/thumbnails/v/1.png?hash=abc' },
            ],
            width: 480,
            height: 270,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useDeckThumbnails(
        'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        2,
      ),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.thumbnailUrls).toBeNull()
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_300)
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.thumbnailUrls).toEqual([
      '/api/decks/d/thumbnails/v/0.png?hash=abc',
      '/api/decks/d/thumbnails/v/1.png?hash=abc',
    ])
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('clears stale thumbnails immediately when the version changes', async () => {
    let resolveSecondFetch: (response: Response) => void = () => undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ready',
            slides: [{ index: 0, url: '/api/decks/d/thumbnails/v1/0.png?hash=abc' }],
            width: 480,
            height: 270,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecondFetch = resolve
          }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ versionId }) => useDeckThumbnails('b0000000-0000-4000-8000-000000000001', versionId, 1),
      { initialProps: { versionId: 'a0000000-0000-4000-8000-000000000001' } },
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.thumbnailUrls).toEqual(['/api/decks/d/thumbnails/v1/0.png?hash=abc'])

    // Switch versions while the second fetch is still in flight: the previous
    // version's thumbnails must not linger.
    rerender({ versionId: 'a0000000-0000-4000-8000-000000000002' })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBeNull()
    expect(result.current.thumbnailUrls).toBeNull()

    resolveSecondFetch(
      new Response(JSON.stringify({ status: 'pending', slides: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.thumbnailUrls).toBeNull()
  })

  it('keeps fallback behavior for disabled status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'disabled', slides: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ versionId }) => useDeckThumbnails('b0000000-0000-4000-8000-000000000001', versionId, 2),
      {
        initialProps: { versionId: 'a0000000-0000-4000-8000-000000000001' },
      },
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('disabled')
    expect(result.current.thumbnailUrls).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ versionId: 'a0000000-0000-4000-8000-000000000099' })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('disabled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps fallback behavior for failed status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'failed', slides: [], error: 'boom' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const { result } = renderHook(() =>
      useDeckThumbnails(
        'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000002',
        2,
      ),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('failed')
    expect(result.current.thumbnailUrls).toBeNull()
    expect(result.current.error).toBe('boom')
  })
})
