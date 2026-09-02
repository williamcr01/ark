import { useDeckStore } from './deck-store.ts'
import { useShellStore } from './shell-store.ts'

export { useDeckStore } from './deck-store.ts'
export { useShellStore } from './shell-store.ts'

export function resetAllStores() {
  useDeckStore.getState().reset()
  useShellStore.getState().reset()
}
