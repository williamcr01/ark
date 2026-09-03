import { useChatStore } from './chat-store.ts'
import { useDeckStore } from './deck-store.ts'
import { useEditorStore } from './editor-store.ts'
import { useModelsStore } from './models-store.ts'
import { useShellStore } from './shell-store.ts'

export { useChatStore } from './chat-store.ts'
export { useDeckStore } from './deck-store.ts'
export { useEditorStore } from './editor-store.ts'
export { useModelsStore } from './models-store.ts'
export { useShellStore } from './shell-store.ts'

export function resetAllStores() {
  useDeckStore.getState().reset()
  useChatStore.getState().reset()
  useEditorStore.getState().reset()
  useShellStore.getState().reset()
  useModelsStore.getState().reset()
}
