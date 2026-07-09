import { createElement, createRef } from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useFrameNavigationGuard } from './useFrameNavigationGuard'

function createIframeHarness(iframeKey: string, enabled = true) {
  const iframeRef = createRef<HTMLIFrameElement>()

  function Harness({ keyValue, guardEnabled }: { keyValue: string; guardEnabled: boolean }) {
    const { compromised } = useFrameNavigationGuard(iframeRef, keyValue, {
      enabled: guardEnabled,
    })

    return createElement(
      'div',
      { 'data-compromised': compromised ? 'true' : 'false' },
      createElement('iframe', {
        key: keyValue,
        ref: iframeRef,
        title: 'test-frame',
        src: 'about:blank',
      }),
    )
  }

  const view = render(createElement(Harness, { keyValue: iframeKey, guardEnabled: enabled }))

  return {
    iframeRef,
    rerender(nextKey: string, nextEnabled = enabled) {
      view.rerender(createElement(Harness, { keyValue: nextKey, guardEnabled: nextEnabled }))
    },
    isCompromised() {
      return view.container.querySelector('[data-compromised]')?.getAttribute('data-compromised')
    },
    fireLoad() {
      const iframe = iframeRef.current

      if (!iframe) {
        throw new Error('iframe not mounted')
      }

      act(() => {
        iframe.dispatchEvent(new Event('load'))
      })
    },
  }
}

describe('useFrameNavigationGuard', () => {
  it('treats the first load as expected', () => {
    const harness = createIframeHarness('session-1')

    harness.fireLoad()
    expect(harness.isCompromised()).toBe('false')
  })

  it('marks compromised on a second load for the same key', () => {
    const harness = createIframeHarness('session-1')

    harness.fireLoad()
    harness.fireLoad()
    expect(harness.isCompromised()).toBe('true')
  })

  it('ignores further loads after compromise (src clear)', () => {
    const harness = createIframeHarness('session-1')

    harness.fireLoad()
    harness.fireLoad()
    expect(harness.isCompromised()).toBe('true')

    harness.fireLoad()
    expect(harness.isCompromised()).toBe('true')
  })

  it('resets when the iframe key changes (shell reload)', () => {
    const harness = createIframeHarness('session-1')

    harness.fireLoad()
    harness.fireLoad()
    expect(harness.isCompromised()).toBe('true')

    act(() => {
      harness.rerender('session-2')
    })

    expect(harness.isCompromised()).toBe('false')
    harness.fireLoad()
    expect(harness.isCompromised()).toBe('false')
  })

  it('does nothing when disabled', () => {
    const { result, rerender } = renderHook(
      ({ key, enabled }) => {
        const iframeRef = createRef<HTMLIFrameElement>()
        return useFrameNavigationGuard(iframeRef, key, { enabled })
      },
      { initialProps: { key: 'a', enabled: false } },
    )

    expect(result.current.compromised).toBe(false)
    rerender({ key: 'a', enabled: true })
    expect(result.current.compromised).toBe(false)
  })
})
