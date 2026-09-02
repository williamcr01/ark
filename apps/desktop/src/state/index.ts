import { useChatStore } from './chat-store.ts'
import { useDeckStore } from './deck-store.ts'
import { useShellStore } from './shell-store.ts'

export { useChatStore } from './chat-store.ts'
export { useDeckStore } from './deck-store.ts'
export { useShellStore } from './shell-store.ts'

export function resetAllStores() {
  useDeckStore.getState().reset()
  useChatStore.getState().reset()
  useShellStore.getState().reset()
}
