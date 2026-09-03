import { AgentQuestions } from '@/components/AgentQuestions'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { formatAgentQuestionAnswers, type AgentQuestionRequest } from '@ark/chat/agent-questions.ts'
import type { McpPendingInteraction } from '@ark/contracts'

export function ChatQuestionsPanel({
  canGenerate,
  isGenerating,
  mcpInteraction,
  request,
}: {
  canGenerate: boolean
  isGenerating: boolean
  mcpInteraction: McpPendingInteraction | null
  request: AgentQuestionRequest
}) {
  const { generateDeck, mcp } = useChatPanelRuntime()
  const onMcpInteractionSubmit = mcp.respondToMcpInteraction

  return (
    <AgentQuestions
      disabled={isGenerating || (!mcpInteraction && !canGenerate)}
      onSubmit={(answers) => {
        if (mcpInteraction?.kind === 'questions') {
          void onMcpInteractionSubmit({ kind: 'questions', answers })
          return
        }
        void generateDeck(formatAgentQuestionAnswers(request, answers), [])
      }}
      request={request}
      submitLabel="Send answers"
    />
  )
}
