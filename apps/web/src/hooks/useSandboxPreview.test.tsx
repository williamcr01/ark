import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSandboxPreview } from './useSandboxPreview'

const deckHtml = (label: string) => `<section class="slide"><h1>${label}</h1></section>`

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function previewSessionResponse(token: string) {
  return new Response(
    JSON.stringify({
      token,
      handshake: `handshake-${token}`,
      expiresAt: Date.now() + 60_000,
      sandboxOrigin: 'http://localhost:5174',
      renderUrl: `http://localhost:5174/render/${token}`,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

async function resolvePreviewSession(deferred: Deferred<Response>, token: string) {
  await act(async () => {
    deferred.resolve(previewSessionResponse(token))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

function requestSignal(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined
  return init?.signal as AbortSignal | undefined
}

describe('useSandboxPreview', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('creates the first preview session immediately', async () => {
    const firstSession = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(firstSession.promise)

    const { result } = renderHook(() => useSandboxPreview(deckHtml('First'), true))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestBody(fetchMock, 0)).toMatchObject({
      html: deckHtml('First'),
      editorBridge: true,
    })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.previewUrl).toBeNull()

    await resolvePreviewSession(firstSession, 'first-token')

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStale).toBe(false)
    expect(result.current.sessionToken).toBe('first-token')
    expect(result.current.handshake).toBe('handshake-first-token')
    expect(result.current.previewUrl).toBe(
      'http://localhost:5174/render/first-token?parent=http%3A%2F%2Flocalhost%3A5173',
    )
  })

  it('starts a discrete committed refresh immediately after idle time', async () => {
    const firstSession = createDeferred<Response>()
    const secondSession = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(firstSession.promise).mockReturnValueOnce(secondSession.promise)

    const { result, rerender } = renderHook(({ html }) => useSandboxPreview(html, true), {
      initialProps: { html: deckHtml('First') },
    })
    await resolvePreviewSession(firstSession, 'first-token')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    rerender({ html: deckHtml('Second') })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestBody(fetchMock, 1)).toMatchObject({
      html: deckHtml('Second'),
      editorBridge: true,
    })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.isStale).toBe(true)
    expect(result.current.previewUrl).toContain('/render/first-token?')
    expect(result.current.sessionToken).toBe('first-token')
    // HTML-only stale keeps the bridge armed for the content still on screen.
    expect(result.current.handshake).toBe('handshake-first-token')

    await resolvePreviewSession(secondSession, 'second-token')

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStale).toBe(false)
    expect(result.current.sessionToken).toBe('second-token')
    expect(result.current.handshake).toBe('handshake-second-token')
  })

  it('coalesces rapid HTML bursts into one trailing replacement session', async () => {
    const firstSession = createDeferred<Response>()
    const immediateRefresh = createDeferred<Response>()
    const trailingRefresh = createDeferred<Response>()
    fetchMock
      .mockReturnValueOnce(firstSession.promise)
      .mockReturnValueOnce(immediateRefresh.promise)
      .mockReturnValueOnce(trailingRefresh.promise)

    const { result, rerender } = renderHook(({ html }) => useSandboxPreview(html, true), {
      initialProps: { html: deckHtml('First') },
    })
    await resolvePreviewSession(firstSession, 'first-token')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    rerender({ html: deckHtml('Second') })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const abortedRefreshSignal = requestSignal(fetchMock, 1)
    expect(abortedRefreshSignal?.aborted).toBe(false)

    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ html: deckHtml('Third') })

    expect(abortedRefreshSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.isStale).toBe(true)
    expect(result.current.sessionToken).toBe('first-token')
    expect(result.current.handshake).toBe('handshake-first-token')
    expect(result.current.previewUrl).toContain('/render/first-token?')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(requestBody(fetchMock, 2)).toMatchObject({
      html: deckHtml('Third'),
      editorBridge: true,
    })

    await resolvePreviewSession(trailingRefresh, 'third-token')

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStale).toBe(false)
    expect(result.current.sessionToken).toBe('third-token')
    expect(result.current.handshake).toBe('handshake-third-token')
    expect(result.current.previewUrl).toContain('/render/third-token?')
  })

  it('keeps the previous session visible with handshake when a replacement fails', async () => {
    const firstSession = createDeferred<Response>()
    const failedRefresh = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(firstSession.promise).mockReturnValueOnce(failedRefresh.promise)

    const { result, rerender } = renderHook(({ html }) => useSandboxPreview(html, true), {
      initialProps: { html: deckHtml('First') },
    })
    await resolvePreviewSession(firstSession, 'first-token')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    rerender({ html: deckHtml('Second') })

    await act(async () => {
      failedRefresh.resolve(
        new Response(JSON.stringify({ error: 'nope' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStale).toBe(true)
    expect(result.current.error).toBe('nope')
    expect(result.current.sessionToken).toBe('first-token')
    expect(result.current.handshake).toBe('handshake-first-token')
    expect(result.current.previewUrl).toContain('/render/first-token?')
  })

  it('keeps the current interactive session when editorBridge toggles', async () => {
    const previewSession = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(previewSession.promise)

    const { result, rerender } = renderHook(
      ({ html, editorBridge }) => useSandboxPreview(html, true, { editorBridge }),
      {
        initialProps: { html: deckHtml('Deck'), editorBridge: false },
      },
    )
    await resolvePreviewSession(previewSession, 'preview-token')

    expect(requestBody(fetchMock, 0)).toMatchObject({
      html: deckHtml('Deck'),
      editorBridge: true,
    })
    expect(result.current.previewUrl).toContain('/render/preview-token?')
    expect(result.current.sessionToken).toBe('preview-token')
    expect(result.current.handshake).toBe('handshake-preview-token')
    expect(result.current.isStale).toBe(false)

    rerender({ html: deckHtml('Deck'), editorBridge: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStale).toBe(false)
    expect(result.current.previewUrl).toContain('/render/preview-token?')
    expect(result.current.sessionToken).toBe('preview-token')
    expect(result.current.handshake).toBe('handshake-preview-token')
    expect(result.current.error).toBeNull()
  })

  it('does not abort an in-flight session when editorBridge toggles', async () => {
    const previewSession = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(previewSession.promise)

    const { result, rerender } = renderHook(
      ({ html, editorBridge }) => useSandboxPreview(html, true, { editorBridge }),
      {
        initialProps: { html: deckHtml('Deck'), editorBridge: false },
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const previewSignal = requestSignal(fetchMock, 0)

    rerender({ html: deckHtml('Deck'), editorBridge: true })

    expect(previewSignal?.aborted).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.previewUrl).toBeNull()
    expect(result.current.sessionToken).toBeNull()
    expect(result.current.handshake).toBeNull()
    expect(result.current.isStale).toBe(false)

    await resolvePreviewSession(previewSession, 'preview-token')

    expect(result.current.sessionToken).toBe('preview-token')
    expect(result.current.handshake).toBe('handshake-preview-token')
    expect(result.current.previewUrl).toContain('/render/preview-token?')
  })
})
