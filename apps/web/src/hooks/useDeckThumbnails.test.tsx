import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDeckThumbnails } from './useDeckThumbnails'

describe('useDeckThumbnails', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns null urls for unsaved decks', () => {
    const { result } = renderHook(() => useDeckThumbnails(null, null, 3))
    expect(result.current.thumbnailUrls).toBeNull()
    expect(result.current.status).toBeNull()
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

    await waitFor(() => {
      expect(result.current.status).toBe('pending')
    })

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
      expect(result.current.thumbnailUrls).toEqual([
        '/api/decks/d/thumbnails/v/0.png?hash=abc',
        '/api/decks/d/thumbnails/v/1.png?hash=abc',
      ])
    })

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps fallback behavior for disabled status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'disabled', slides: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const { result } = renderHook(() =>
      useDeckThumbnails(
        'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        2,
      ),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('disabled')
      expect(result.current.thumbnailUrls).toBeNull()
    })
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

    await waitFor(() => {
      expect(result.current.status).toBe('failed')
      expect(result.current.thumbnailUrls).toBeNull()
      expect(result.current.error).toBe('boom')
    })
  })
})
