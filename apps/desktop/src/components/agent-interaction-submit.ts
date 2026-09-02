import type { AgentQuestionAnswers, AgentQuestionRequest } from '@ark/chat/agent-questions.ts'
import { formatAgentQuestionAnswers } from '@ark/chat/agent-questions.ts'
import type { ChatMessageContext } from '@ark/chat/chat.ts'
import type { StoredThemeProposalRequest } from '@ark/chat/agent-themes.ts'
import { formatThemeChoice, THEME_REFRESH_PROMPT } from '@ark/chat/agent-themes.ts'
import type { McpInteractionAnswer } from '@ark/contracts'
import type { ThemePickerResult } from '@/components/ThemePickerLayout.tsx'

export type ActiveInteraction =
  | {
      source: 'mcp'
      kind: 'questions'
      request: AgentQuestionRequest
      clientName: string | null
    }
  | {
      source: 'mcp'
      kind: 'themes'
      request: StoredThemeProposalRequest
      clientName: string | null
    }
  | { source: 'agent'; kind: 'questions'; request: AgentQuestionRequest }
  | { source: 'agent'; kind: 'themes'; request: StoredThemeProposalRequest }

export function submitQuestionAnswers(
  interaction: Extract<ActiveInteraction, { kind: 'questions' }>,
  answers: AgentQuestionAnswers,
  onMcpInteractionSubmit?: (answer: McpInteractionAnswer) => void,
  onAgentQuestionSubmit?: (content: string, context?: ChatMessageContext) => void,
) {
  if (interaction.source === 'mcp') {
    onMcpInteractionSubmit?.({ kind: 'questions', answers })
    return
  }
  onAgentQuestionSubmit?.(formatAgentQuestionAnswers(interaction.request, answers))
}

export function submitThemeResult(
  interaction: Extract<ActiveInteraction, { kind: 'themes' }>,
  result: ThemePickerResult,
  onMcpInteractionSubmit?: (answer: McpInteractionAnswer) => void,
  onAgentQuestionSubmit?: (content: string, context?: ChatMessageContext) => void,
) {
  if (interaction.source === 'mcp') {
    if (result.action === 'refresh') {
      onMcpInteractionSubmit?.({ kind: 'themes', refresh: true })
      return
    }
    if (!result.theme) return
    onMcpInteractionSubmit?.({
      kind: 'themes',
      themeId: result.themeId,
      fonts: result.fonts,
      theme: result.theme,
    })
    return
  }
  if (result.action === 'refresh') {
    onAgentQuestionSubmit?.(THEME_REFRESH_PROMPT)
    return
  }
  onAgentQuestionSubmit?.(
    formatThemeChoice(interaction.request, result.themeId, result.fonts, result.theme),
    result.theme
      ? {
          themeSelection: {
            themeId: result.themeId,
            name: result.name,
            fonts: result.fonts,
            theme: result.theme,
          },
        }
      : undefined,
  )
}
