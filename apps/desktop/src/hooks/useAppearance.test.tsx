import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetDesktopSettingsForTests } from '@/lib/desktop-settings'
import { useAppearance } from './useAppearance'

function installMatchMedia(initial = false) {
  let matches = initial
  const listeners = new Set<() => void>()
  const media = {
    get matches() {
      return matches
    },
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => media as unknown as MediaQueryList),
  })
  return {
    media,
    setMatches(value: boolean) {
      matches = value
      listeners.forEach((listener) => listener())
    },
  }
}

afterEach(() => document.documentElement.classList.remove('dark'))

describe('useAppearance', () => {
  it('defaults to system and follows system changes', () => {
    const system = installMatchMedia(false)
    const { result } = renderHook(useAppearance)
    expect(result.current.preference).toBe('system')
    expect(result.current.resolvedAppearance).toBe('light')

    act(() => system.setMatches(true))
    expect(result.current.resolvedAppearance).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('persists explicit appearance without listening for system changes', () => {
    const { media } = installMatchMedia(false)
    resetDesktopSettingsForTests({ appearance: 'dark' })
    const { result } = renderHook(useAppearance)
    expect(result.current.resolvedAppearance).toBe('dark')
    expect(media.addEventListener).not.toHaveBeenCalled()

    act(() => result.current.setPreference('light'))
    expect(window.arkDesktop.settings.update).toHaveBeenCalledWith({ appearance: 'light' })
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
