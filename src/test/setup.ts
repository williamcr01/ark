import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

const localStorageMock = createLocalStorageMock()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: localStorageMock,
})

class TestResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

class TestIntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }

  observe = vi.fn((target: Element) => {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this as unknown as IntersectionObserver,
    )
  })

  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})

Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  value: TestIntersectionObserver,
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
})

Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
})

Object.defineProperty(document, 'exitFullscreen', {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
})

afterEach(() => {
  localStorageMock.clear()
  cleanup()
  vi.clearAllMocks()
})
