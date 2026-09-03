import { CableIcon, SparklesIcon } from 'lucide-react'

import type { ChatMessageContext } from '@ark/chat/context.ts'
import type { McpInteractionAnswer } from '@ark/contracts'
import { AgentQuestions } from '@/components/AgentQuestions'
import { ThemePicker } from '@/components/ThemePicker'
import { Button } from '@/components/ui/button'
import {
  submitQuestionAnswers,
  submitThemeResult,
  type ActiveInteraction,
} from './agent-interaction-submit.ts'

export type { ActiveInteraction }

export function AgentInteractionBanner({
  interaction,
  onMcpInteractionCancel,
}: {
  interaction: ActiveInteraction
  onMcpInteractionCancel?: () => void | Promise<void>
}) {
  if (interaction.source === 'mcp') {
    return (
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
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-border/60 pb-3 text-xs text-muted-foreground">
      <SparklesIcon aria-hidden className="size-3.5 text-[var(--ark-focus)]" />
      <span>Ark is waiting for your direction.</span>
    </div>
  )
}

export function AgentInteractionFields({
  disabled,
  interaction,
  onAgentQuestionSubmit,
  onMcpInteractionSubmit,
}: {
  disabled: boolean
  interaction: ActiveInteraction
  onAgentQuestionSubmit?: (content: string, context?: ChatMessageContext) => void
  onMcpInteractionSubmit?: (answer: McpInteractionAnswer) => void
}) {
  const questionInteraction = interaction.kind === 'questions' ? interaction : null
  const themeInteraction = interaction.kind === 'themes' ? interaction : null

  return (
    <>
      {questionInteraction ? (
        <AgentQuestions
          disabled={disabled && questionInteraction.source === 'agent'}
          onSubmit={(answers) =>
            submitQuestionAnswers(
              questionInteraction,
              answers,
              onMcpInteractionSubmit,
              onAgentQuestionSubmit,
            )
          }
          request={questionInteraction.request}
          submitLabel="Send answers"
        />
      ) : null}
      {themeInteraction ? (
        <ThemePicker
          disabled={disabled && themeInteraction.source === 'agent'}
          onSubmit={(result) =>
            submitThemeResult(
              themeInteraction,
              result,
              onMcpInteractionSubmit,
              onAgentQuestionSubmit,
            )
          }
          request={themeInteraction.request}
          submitLabel="Use this theme"
        />
      ) : null}
    </>
  )
}
