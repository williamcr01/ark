import { ThemePicker } from '@/components/ThemePicker'
import type { ThemePickerResult } from '@/components/ThemePickerLayout.tsx'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { formatThemeChoice, THEME_REFRESH_PROMPT } from '@ark/chat/agent-themes.ts'
import type { StoredThemeProposalRequest } from '@ark/chat/agent-themes.ts'
import type { McpPendingInteraction } from '@ark/contracts'

function submitThemeChoice(
  result: ThemePickerResult,
  input: {
    generateDeck: ReturnType<typeof useChatPanelRuntime>['generateDeck']
    mcpInteraction: McpPendingInteraction | null
    onMcpInteractionSubmit: ReturnType<typeof useChatPanelRuntime>['mcp']['respondToMcpInteraction']
    request: StoredThemeProposalRequest
  },
) {
  if (input.mcpInteraction?.kind === 'themes') {
    if (result.action === 'refresh') {
      void input.onMcpInteractionSubmit({ kind: 'themes', refresh: true })
      return
    }
    if (!result.theme) {
      return
    }
    void input.onMcpInteractionSubmit({
      kind: 'themes',
      themeId: result.themeId,
      fonts: result.fonts,
      theme: result.theme,
    })
    return
  }
  if (result.action === 'refresh') {
    void input.generateDeck(THEME_REFRESH_PROMPT, [])
    return
  }
  void input.generateDeck(
    formatThemeChoice(input.request, result.themeId, result.fonts, result.theme),
    [],
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

export function ChatThemesPanel({
  canGenerate,
  isGenerating,
  isHome,
  mcpInteraction,
  request,
}: {
  canGenerate: boolean
  isGenerating: boolean
  isHome: boolean
  mcpInteraction: McpPendingInteraction | null
  request: StoredThemeProposalRequest
}) {
  const { generateDeck, mcp } = useChatPanelRuntime()
  const onMcpInteractionSubmit = mcp.respondToMcpInteraction

  return (
    <ThemePicker
      disabled={isGenerating || (!mcpInteraction && !canGenerate)}
      onSubmit={(result) =>
        submitThemeChoice(result, {
          generateDeck,
          mcpInteraction,
          onMcpInteractionSubmit,
          request,
        })
      }
      request={request}
      size={isHome ? 'lg' : 'sm'}
      submitLabel="Use this theme"
    />
  )
}
