import { AgentInteractionModal } from '@/components/AgentInteractionModal'
import { findPendingAgentQuestions } from '@/lib/chat/agent-questions'
import { findPendingThemeProposal } from '@/lib/chat/agent-themes'
import { useMcpInteraction } from '@/hooks/useMcpInteraction'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { useShellStore } from '@/state/shell-store.ts'

export function WorkspaceAgentModal() {
  const { persistence, chat, generation, models, workspaceMode } = useWorkspaceRuntimeContext()
  const agentInteractionsInModal = useShellStore((state) => state.agentInteractionsInModal)
  const isCreationWorkspace = workspaceMode === 'create'
  const enabled = agentInteractionsInModal && !isCreationWorkspace
  const { activeMcpInteraction, cancelMcpInteraction, respondToMcpInteraction } = useMcpInteraction(
    persistence.deckId,
  )

  return (
    <AgentInteractionModal
      agentQuestions={enabled ? findPendingAgentQuestions(chat.messages) : null}
      disabled={generation.isGenerating || !models.canGenerate}
      mcpInteraction={activeMcpInteraction}
      onAgentQuestionSubmit={(content, context) => {
        void generation.generateDeck(content, [], {
          themeSelection: context?.themeSelection,
        })
      }}
      onMcpInteractionCancel={() => {
        void cancelMcpInteraction()
      }}
      onMcpInteractionSubmit={(answer) => {
        void respondToMcpInteraction(answer)
      }}
      themeProposal={enabled ? findPendingThemeProposal(chat.messages) : null}
    />
  )
}
