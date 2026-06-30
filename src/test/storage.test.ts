import { describe, expect, it } from 'vitest'

import {
  createLocalStorageMock,
  getTestLocalStorage,
  installTestLocalStorage,
} from './storage'

describe('test storage helpers', () => {
  it('installs an in-memory localStorage when the runtime has none', () => {
    const original = globalThis.localStorage

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: undefined,
    })

    try {
      const storage = installTestLocalStorage()
      storage.setItem('ark:active-deck-id', 'deck-1')
      expect(getTestLocalStorage().getItem('ark:active-deck-id')).toBe('deck-1')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      })
    }
  })

  it('supports clear and removeItem', () => {
    const storage = createLocalStorageMock()
    storage.setItem('a', '1')
    storage.removeItem('a')
    expect(storage.getItem('a')).toBeNull()
    storage.setItem('b', '2')
    storage.clear()
    expect(storage.length).toBe(0)
  })
})
