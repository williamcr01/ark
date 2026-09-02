import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { findPendingAgentQuestions } from '@/lib/chat/agent-questions'
import { findPendingThemeProposal } from '@/lib/chat/agent-themes'
import { useChatStore } from '@/state/chat-store.ts'

export function useChatInteractionLock() {
  const { layout, canGenerate, mcp, interactiveToolsInModal } = useChatPanelRuntime()
  const messages = useChatStore((state) => state.messages)
  const pendingAgentQuestions = findPendingAgentQuestions(messages)
  const pendingThemeProposal = findPendingThemeProposal(messages)
  const mcpInteraction = mcp.activeMcpInteraction
  const activeQuestions =
    mcpInteraction?.kind === 'questions'
      ? mcpInteraction.request
      : interactiveToolsInModal
        ? null
        : pendingAgentQuestions
  const activeThemes =
    mcpInteraction?.kind === 'themes'
      ? mcpInteraction.request
      : interactiveToolsInModal
        ? null
        : pendingThemeProposal
  const interactionActive = Boolean(
    activeQuestions ||
    activeThemes ||
    (interactiveToolsInModal && (pendingAgentQuestions || pendingThemeProposal)),
  )

  return {
    layout,
    canGenerate,
    activeQuestions,
    activeThemes,
    interactionActive,
    mcpInteraction,
  }
}
