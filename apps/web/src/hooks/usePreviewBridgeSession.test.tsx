import { createElement, createRef, useEffect } from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDeckHandshakeMessage } from '@ark/deck-core/deck-bridge.ts'

import {
  usePreviewBridgeSession,
  type PreviewBridgeCompromiseReason,
} from './usePreviewBridgeSession'

describe('usePreviewBridgeSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps canPostToFrame false until handshake and trusted load arm the session', () => {
    const { result } = renderHook(() =>
      usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'hs-1',
        sandboxOrigin: null,
      }),
    )

    expect(result.current.phase).toBe('awaiting-handshake')
    expect(result.current.canPostToFrame()).toBe(false)

    act(() => {
      const decision = result.current.onFrameLoad()
      expect(decision.allowDownstream).toBe(false)
    })

    expect(result.current.canPostToFrame()).toBe(false)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckHandshakeMessage('hs-1'),
          origin: window.location.origin,
        }),
      )
    })

    expect(result.current.phase).toBe('armed')
    expect(result.current.canPostToFrame()).toBe(true)
    expect(result.current.compromisedRef.current).toBe(false)
  })

  it('arms when a late handshake retry arrives after the trusted load', () => {
    const { result } = renderHook(() =>
      usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'hs-late',
        sandboxOrigin: null,
      }),
    )

    act(() => {
      expect(result.current.onFrameLoad().allowDownstream).toBe(false)
    })

    expect(result.current.canPostToFrame()).toBe(false)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckHandshakeMessage('hs-late'),
          origin: window.location.origin,
        }),
      )
    })

    expect(result.current.phase).toBe('armed')
    expect(result.current.canPostToFrame()).toBe(true)

    act(() => {
      // Sentinel retries must stay idempotent and must not compromise the session.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckHandshakeMessage('hs-late'),
          origin: window.location.origin,
        }),
      )
    })

    expect(result.current.phase).toBe('armed')
    expect(result.current.compromised).toBe(false)
  })

  it('flips compromisedRef synchronously on unexpected second load', () => {
    const onCompromised = vi.fn()
    const { result } = renderHook(() =>
      usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'hs-1',
        sandboxOrigin: null,
        onCompromised,
      }),
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckHandshakeMessage('hs-1'),
          origin: window.location.origin,
        }),
      )
      expect(result.current.onFrameLoad().allowDownstream).toBe(true)
    })

    expect(result.current.canPostToFrame()).toBe(true)

    let decisionAllow = true
    act(() => {
      // Synchronous gate flip before React state commits.
      const decision = result.current.onFrameLoad()
      decisionAllow = decision.allowDownstream
      expect(result.current.compromisedRef.current).toBe(true)
      expect(result.current.canPostToFrame()).toBe(false)
    })

    expect(decisionAllow).toBe(false)
    expect(result.current.compromised).toBe(true)
    expect(onCompromised).toHaveBeenCalledWith('unexpected-load')
  })

  it('marks compromised on invalid handshake', () => {
    const onCompromised = vi.fn()
    const { result } = renderHook(() =>
      usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'expected',
        sandboxOrigin: null,
        onCompromised,
      }),
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckHandshakeMessage('wrong'),
          origin: window.location.origin,
        }),
      )
    })

    expect(result.current.compromised).toBe(true)
    expect(result.current.canPostToFrame()).toBe(false)
    expect(onCompromised).toHaveBeenCalledWith('invalid-handshake')
  })

  it('ignores stale-frame handshakes when frameRef is provided (rapid remount race)', () => {
    const onCompromised = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const currentFrame = document.createElement('iframe')
    const previousFrame = document.createElement('iframe')
    container.appendChild(currentFrame)
    container.appendChild(previousFrame)
    const frameRef = createRef<HTMLIFrameElement>() as React.RefObject<HTMLIFrameElement | null>
    frameRef.current = currentFrame

    try {
      const { result } = renderHook(() =>
        usePreviewBridgeSession('gen-2', {
          enabled: true,
          handshake: 'hs-new',
          frameRef,
          sandboxOrigin: null,
          onCompromised,
        }),
      )

      act(() => {
        result.current.onFrameLoad()
      })

      // In-flight sentinel retry from the previous iframe generation carries
      // the old handshake value; it must be ignored, not compromise gen-2.
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: createDeckHandshakeMessage('hs-old'),
            origin: window.location.origin,
            source: previousFrame.contentWindow,
          }),
        )
      })

      expect(result.current.compromised).toBe(false)
      expect(onCompromised).not.toHaveBeenCalled()

      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: createDeckHandshakeMessage('hs-new'),
            origin: window.location.origin,
            source: currentFrame.contentWindow,
          }),
        )
      })

      expect(result.current.phase).toBe('armed')
      expect(result.current.canPostToFrame()).toBe(true)
    } finally {
      container.remove()
    }
  })

  it('still compromises on a wrong handshake from the live frame', () => {
    const onCompromised = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const currentFrame = document.createElement('iframe')
    container.appendChild(currentFrame)
    const frameRef = createRef<HTMLIFrameElement>() as React.RefObject<HTMLIFrameElement | null>
    frameRef.current = currentFrame

    try {
      const { result } = renderHook(() =>
        usePreviewBridgeSession('gen-1', {
          enabled: true,
          handshake: 'expected',
          frameRef,
          sandboxOrigin: null,
          onCompromised,
        }),
      )

      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: createDeckHandshakeMessage('forged'),
            origin: window.location.origin,
            source: currentFrame.contentWindow,
          }),
        )
      })

      expect(result.current.compromised).toBe(true)
      expect(onCompromised).toHaveBeenCalledWith('invalid-handshake')
    } finally {
      container.remove()
    }
  })

  it('marks compromised when handshake never arrives after load', () => {
    const onCompromised = vi.fn()
    const { result } = renderHook(() =>
      usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'hs-1',
        sandboxOrigin: null,
        handshakeTimeoutMs: 100,
        onCompromised,
      }),
    )

    act(() => {
      result.current.onFrameLoad()
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.compromised).toBe(true)
    expect(onCompromised).toHaveBeenCalledWith('handshake-timeout')
  })

  it('resets on iframe key change', () => {
    const { result, rerender } = renderHook(
      ({ key }) =>
        usePreviewBridgeSession(key, {
          enabled: true,
          handshake: 'hs-1',
          sandboxOrigin: null,
        }),
      { initialProps: { key: 'gen-1' } },
    )

    act(() => {
      result.current.onFrameLoad()
      result.current.onFrameLoad()
    })
    expect(result.current.compromised).toBe(true)

    rerender({ key: 'gen-2' })
    expect(result.current.compromised).toBe(false)
    expect(result.current.canPostToFrame()).toBe(false)
    expect(result.current.phase).toBe('awaiting-handshake')
  })

  it('does not allow downstream sync from onFrameLoad before arming', () => {
    const posts: string[] = []
    const iframeRef = createRef<HTMLIFrameElement>()

    function Harness() {
      const session = usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'hs-1',
        sandboxOrigin: null,
      })

      useEffect(() => {
        // Simulate a racey load handler that checks the sync gate.
        const iframe = iframeRef.current
        if (!iframe) return

        const onLoad = () => {
          const decision = session.onFrameLoad()
          if (decision.allowDownstream && session.canPostToFrame()) {
            posts.push('posted')
          }
        }

        iframe.addEventListener('load', onLoad)
        return () => iframe.removeEventListener('load', onLoad)
      })

      return createElement('iframe', { ref: iframeRef, title: 't', src: 'about:blank' })
    }

    render(createElement(Harness))

    act(() => {
      iframeRef.current?.dispatchEvent(new Event('load'))
    })

    expect(posts).toEqual([])
  })
})

describe('usePreviewBridgeSession compromise reasons', () => {
  it('reports only once per generation', () => {
    const reasons: PreviewBridgeCompromiseReason[] = []
    const { result } = renderHook(() =>
      usePreviewBridgeSession('gen-1', {
        enabled: true,
        handshake: 'hs-1',
        sandboxOrigin: null,
        onCompromised: (reason) => reasons.push(reason),
      }),
    )

    act(() => {
      result.current.onFrameLoad()
      result.current.onFrameLoad()
      result.current.onFrameLoad()
    })

    expect(reasons).toEqual(['unexpected-load'])
  })
})
