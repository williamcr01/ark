import { CableIcon, SparklesIcon } from 'lucide-react'

import type { AgentQuestionRequest } from '@ark/deck-core/agent-questions.ts'
import { formatAgentQuestionAnswers } from '@ark/deck-core/agent-questions.ts'
import type { ThemeProposalRequest } from '@ark/deck-core/agent-themes.ts'
import { formatThemeChoice } from '@ark/deck-core/agent-themes.ts'
import type { McpInteractionAnswer, McpPendingInteraction } from '@ark/contracts'
import { AgentQuestions } from '@/components/AgentQuestions'
import { ThemePicker } from '@/components/ThemePicker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type AgentInteractionModalProps = {
  mcpInteraction?: McpPendingInteraction | null
  agentQuestions?: AgentQuestionRequest | null
  disabled?: boolean
  themeProposal?: ThemeProposalRequest | null
  onMcpInteractionSubmit?: (answer: McpInteractionAnswer) => void
  onMcpInteractionCancel?: () => void | Promise<void>
  onAgentQuestionSubmit?: (content: string) => void
}

type ActiveInteraction =
  | {
      source: 'mcp'
      kind: 'questions'
      request: AgentQuestionRequest
      clientName: string | null
    }
  | {
      source: 'mcp'
      kind: 'themes'
      request: ThemeProposalRequest
      clientName: string | null
    }
  | { source: 'agent'; kind: 'questions'; request: AgentQuestionRequest }
  | { source: 'agent'; kind: 'themes'; request: ThemeProposalRequest }

export function AgentInteractionModal({
  agentQuestions = null,
  disabled = false,
  onAgentQuestionSubmit,
  onMcpInteractionCancel,
  onMcpInteractionSubmit,
  mcpInteraction = null,
  themeProposal = null,
}: AgentInteractionModalProps) {
  const interaction: ActiveInteraction | null = mcpInteraction
    ? mcpInteraction.kind === 'questions'
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
    : agentQuestions
      ? { source: 'agent', kind: 'questions', request: agentQuestions }
      : themeProposal
        ? { source: 'agent', kind: 'themes', request: themeProposal }
        : null

  if (!interaction) return null

  const questionInteraction = interaction.kind === 'questions' ? interaction : null
  const themeInteraction = interaction?.kind === 'themes' ? interaction : null

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (nextOpen || !interaction || interaction.source !== 'mcp') return
        void onMcpInteractionCancel?.()
      }}
      open
    >
      <DialogContent
        className="max-h-[min(760px,calc(100svh-2rem))] w-[min(720px,calc(100%-2rem))] overflow-y-auto bg-[var(--ark-paper)] p-5 sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          if (interaction?.source === 'mcp') void onMcpInteractionCancel?.()
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{interaction?.request.title ?? 'Agent response'}</DialogTitle>
          <DialogDescription>
            {interaction?.source === 'mcp'
              ? 'An external agent is waiting for your response.'
              : 'Answer the agent before it continues.'}
          </DialogDescription>
        </DialogHeader>

        {interaction?.source === 'mcp' ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ark-focus)]/20 bg-[var(--ark-focus)]/5 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <CableIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--ark-focus)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {interaction.clientName ?? 'An external agent'} needs your input
                </p>
                <p className="text-xs text-muted-foreground">
                  Your response will be sent back through MCP.
                </p>
              </div>
            </div>
            {onMcpInteractionCancel ? (
              <Button onClick={() => void onMcpInteractionCancel()} size="sm" variant="ghost">
                Cancel
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-border/60 pb-3 text-xs text-muted-foreground">
            <SparklesIcon aria-hidden className="size-3.5 text-[var(--ark-focus)]" />
            <span>Ark is waiting for your direction.</span>
          </div>
        )}

        {questionInteraction ? (
          <AgentQuestions
            disabled={disabled && questionInteraction.source === 'agent'}
            onSubmit={(answers) => {
              if (questionInteraction.source === 'mcp') {
                onMcpInteractionSubmit?.({ kind: 'questions', answers })
                return
              }
              onAgentQuestionSubmit?.(
                formatAgentQuestionAnswers(questionInteraction.request, answers),
              )
            }}
            request={questionInteraction.request}
            submitLabel="Send answers"
          />
        ) : null}
        {themeInteraction ? (
          <ThemePicker
            disabled={disabled && themeInteraction.source === 'agent'}
            onSubmit={(themeId) => {
              if (themeInteraction.source === 'mcp') {
                onMcpInteractionSubmit?.({ kind: 'themes', themeId })
                return
              }
              onAgentQuestionSubmit?.(formatThemeChoice(themeInteraction.request, themeId))
            }}
            request={themeInteraction.request}
            submitLabel="Use this theme"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
