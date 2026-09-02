import { createContext, useContext, type RefObject } from 'react'

import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import type { WorkspaceMode } from '@/lib/ui/workspace-mode'

import type { useAvailableModels } from './useAvailableModels'
import type { useChatSession } from './useChatSession'
import type { useDeckGenerationFlow } from './useDeckGenerationFlow'
import type { WorkspacePersistence } from './deck-persistence.ts'

export type WorkspaceRuntimeValue = {
  persistence: WorkspacePersistence
  chat: ReturnType<typeof useChatSession>
  generation: ReturnType<typeof useDeckGenerationFlow>
  models: ReturnType<typeof useAvailableModels>
  workspaceMode: WorkspaceMode
  initialSlideIndex: number
  deckPreviewRef: RefObject<DeckPreviewHandle | null>
  htmlRef: RefObject<string>
  readHistorySlideIndex: () => number
}

export const WorkspaceRuntimeContext = createContext<WorkspaceRuntimeValue | null>(null)

export function useWorkspaceRuntimeContext(): WorkspaceRuntimeValue {
  const value = useContext(WorkspaceRuntimeContext)
  if (!value) {
    throw new Error('useWorkspaceRuntimeContext must be used within WorkspaceShell')
  }
  return value
}
