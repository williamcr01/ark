import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { useAppearance } from '@/hooks/useAppearance'
import { useMcpInteraction } from '@/hooks/useMcpInteraction'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePromptSubmit, type UsePromptSubmitResult } from '@/hooks/usePromptSubmit'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { useShellStore } from '@/state/shell-store.ts'
import type { ResolvedAppearance } from '@/hooks/useAppearance'

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

const ChatPanelRuntimeContext = createContext<ChatPanelRuntime | null>(null)

export function ChatPanelRuntimeProvider({
  layout,
  contextSlot,
  children,
}: {
  layout: ChatPanelLayout
  contextSlot?: ReactNode
  children: ReactNode
}) {
  const { chat, generation, models, persistence } = useWorkspaceRuntimeContext()
  const prompt = usePromptSubmit()
  const mcp = useMcpInteraction(persistence.deckId)
  const agentInteractionsInModal = useShellStore((state) => state.agentInteractionsInModal)
  const { resolvedAppearance } = useAppearance()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const interactiveToolsInModal = agentInteractionsInModal && layout !== 'home'

  const value = useMemo<ChatPanelRuntime>(
    () => ({
      layout,
      contextSlot,
      prompt,
      retryPersist: chat.retryPersist,
      generateDeck: generation.generateDeck,
      cancelGeneration: generation.cancelGeneration,
      retryGeneration: generation.retryGeneration,
      canGenerate: models.canGenerate,
      setSelectedModel: models.setSelectedModel,
      mcp,
      interactiveToolsInModal,
      reducedMotion,
      resolvedAppearance,
    }),
    [
      layout,
      contextSlot,
      prompt,
      chat.retryPersist,
      generation.generateDeck,
      generation.cancelGeneration,
      generation.retryGeneration,
      models.canGenerate,
      models.setSelectedModel,
      mcp,
      interactiveToolsInModal,
      reducedMotion,
      resolvedAppearance,
    ],
  )

  return (
    <ChatPanelRuntimeContext.Provider value={value}>{children}</ChatPanelRuntimeContext.Provider>
  )
}

export function useChatPanelRuntime(): ChatPanelRuntime {
  const value = useContext(ChatPanelRuntimeContext)
  if (!value) {
    throw new Error('useChatPanelRuntime must be used within ChatPanel')
  }
  return value
}
