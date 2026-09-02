import { createContext, useContext, type ReactNode } from 'react'

import type { ResolvedAppearance } from '@/hooks/useAppearance'
import type { useMcpInteraction } from '@/hooks/useMcpInteraction'
import type { UsePromptSubmitResult } from '@/hooks/usePromptSubmit'
import type { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'

export type ChatPanelLayout = 'sidebar' | 'home'

export type ChatPanelRuntime = {
  layout: ChatPanelLayout
  contextSlot?: ReactNode
  prompt: UsePromptSubmitResult
  retryPersist: (messageId: string) => void | Promise<void | boolean>
  generateDeck: ReturnType<typeof useWorkspaceRuntimeContext>['generation']['generateDeck']
  cancelGeneration: () => void | Promise<void>
  retryGeneration: () => void | Promise<void>
  canGenerate: boolean
  setSelectedModel: (modelId: string) => void
  mcp: ReturnType<typeof useMcpInteraction>
  interactiveToolsInModal: boolean
  reducedMotion: boolean
  resolvedAppearance: ResolvedAppearance
}

export const ChatPanelRuntimeContext = createContext<ChatPanelRuntime | null>(null)

export function useChatPanelRuntime(): ChatPanelRuntime {
  const value = useContext(ChatPanelRuntimeContext)
  if (!value) {
    throw new Error('useChatPanelRuntime must be used within ChatPanel')
  }
  return value
}
