import type { AgentQuestionRequest } from '@ark/chat/agent-questions.ts'
import type { ChatMessageContext } from '@ark/chat/chat.ts'
import type { StoredThemeProposalRequest } from '@ark/chat/agent-themes.ts'
import type { McpInteractionAnswer, McpPendingInteraction } from '@ark/contracts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { AgentInteractionBanner, AgentInteractionFields } from './AgentInteractionFields.tsx'
import { type ActiveInteraction } from './agent-interaction-submit.ts'

type AgentInteractionModalProps = {
  mcpInteraction?: McpPendingInteraction | null
  agentQuestions?: AgentQuestionRequest | null
  disabled?: boolean
  themeProposal?: StoredThemeProposalRequest | null
  onMcpInteractionSubmit?: (answer: McpInteractionAnswer) => void
  onMcpInteractionCancel?: () => void | Promise<void>
  onAgentQuestionSubmit?: (content: string, context?: ChatMessageContext) => void
}

function resolveActiveInteraction(
  mcpInteraction: McpPendingInteraction | null,
  agentQuestions: AgentQuestionRequest | null,
  themeProposal: StoredThemeProposalRequest | null,
): ActiveInteraction | null {
  if (mcpInteraction) {
    return mcpInteraction.kind === 'questions'
      ? {
          source: 'mcp',
          kind: 'questions',
          request: mcpInteraction.request,
          clientName: mcpInteraction.clientName,
        }
      : {
          source: 'mcp',
          kind: 'themes',
          request: mcpInteraction.request,
          clientName: mcpInteraction.clientName,
        }
  }
  if (agentQuestions) {
    return { source: 'agent', kind: 'questions', request: agentQuestions }
  }
  if (themeProposal) {
    return { source: 'agent', kind: 'themes', request: themeProposal }
  }
  return null
}

export function AgentInteractionModal({
  agentQuestions = null,
  disabled = false,
  onAgentQuestionSubmit,
  onMcpInteractionCancel,
  onMcpInteractionSubmit,
  mcpInteraction = null,
  themeProposal = null,
}: AgentInteractionModalProps) {
  const interaction = resolveActiveInteraction(mcpInteraction, agentQuestions, themeProposal)

  if (!interaction) return null

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (nextOpen || interaction.source !== 'mcp') return
        void onMcpInteractionCancel?.()
      }}
      open
    >
      <DialogContent
        className="max-h-[min(760px,calc(100svh-2rem))] w-[min(720px,calc(100%-2rem))] overflow-y-auto bg-[var(--ark-paper)] p-5 sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          if (interaction.source === 'mcp') void onMcpInteractionCancel?.()
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{interaction.request.title ?? 'Agent response'}</DialogTitle>
          <DialogDescription>
            {interaction.source === 'mcp'
              ? 'An external agent is waiting for your response.'
              : 'Answer the agent before it continues.'}
          </DialogDescription>
        </DialogHeader>

        <AgentInteractionBanner
          interaction={interaction}
          onMcpInteractionCancel={onMcpInteractionCancel}
        />
        <AgentInteractionFields
          disabled={disabled}
          interaction={interaction}
          onAgentQuestionSubmit={onAgentQuestionSubmit}
          onMcpInteractionSubmit={onMcpInteractionSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
