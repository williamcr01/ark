export function createLocalStorageMock(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

export function installTestLocalStorage() {
  const storage = createLocalStorageMock()

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  })

  return storage
}

export function getTestLocalStorage(): Storage {
  if (typeof globalThis.localStorage === 'undefined') {
    return installTestLocalStorage()
  }

  return globalThis.localStorage
}
