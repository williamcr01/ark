import { AgentQuestions } from '@/components/AgentQuestions'
import { ThemePicker } from '@/components/ThemePicker'
import { useChatInteractionLock } from '@/components/chat/chat-interaction-lock'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { cn } from '@/lib/ui/utils'
import { useChatStore } from '@/state/chat-store.ts'
import { formatAgentQuestionAnswers } from '@ark/chat/agent-questions.ts'
import { formatThemeChoice, THEME_REFRESH_PROMPT } from '@ark/chat/agent-themes.ts'

export function ChatInteractions() {
  const { generateDeck, canGenerate, mcp } = useChatPanelRuntime()
  const isGenerating = useChatStore((state) => state.isGenerating)
  const { layout, activeQuestions, activeThemes, mcpInteraction } = useChatInteractionLock()
  const isHome = layout === 'home'
  const onMcpInteractionSubmit = mcp.respondToMcpInteraction
  const questionHandler =
    activeQuestions &&
    (mcpInteraction?.kind === 'questions' ? onMcpInteractionSubmit : generateDeck)
  const themeHandler =
    activeThemes && (mcpInteraction?.kind === 'themes' ? onMcpInteractionSubmit : generateDeck)

  if (!questionHandler && !themeHandler) {
    return null
  }

  return (
    <div
      className={cn(
        'shrink-0 overflow-y-auto',
        isHome ? 'px-1 sm:px-2' : 'px-4',
        isHome ? 'max-h-[min(70vh,40rem)]' : 'max-h-[min(50vh,28rem)]',
      )}
    >
      <div className="flex flex-col gap-4">
        {activeQuestions && questionHandler ? (
          <AgentQuestions
            disabled={isGenerating || (!mcpInteraction && !canGenerate)}
            onSubmit={(answers) => {
              if (mcpInteraction?.kind === 'questions') {
                void onMcpInteractionSubmit({ kind: 'questions', answers })
                return
              }
              void generateDeck(formatAgentQuestionAnswers(activeQuestions, answers), [])
            }}
            request={activeQuestions}
            submitLabel="Send answers"
          />
        ) : null}
        {activeThemes && themeHandler ? (
          <ThemePicker
            disabled={isGenerating || (!mcpInteraction && !canGenerate)}
            onSubmit={(result) => {
              if (mcpInteraction?.kind === 'themes') {
                if (result.action === 'refresh') {
                  void onMcpInteractionSubmit({ kind: 'themes', refresh: true })
                  return
                }
                if (!result.theme) return
                void onMcpInteractionSubmit({
                  kind: 'themes',
                  themeId: result.themeId,
                  fonts: result.fonts,
                  theme: result.theme,
                })
                return
              }
              if (result.action === 'refresh') {
                void generateDeck(THEME_REFRESH_PROMPT, [])
                return
              }
              void generateDeck(
                formatThemeChoice(activeThemes, result.themeId, result.fonts, result.theme),
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
            }}
            request={activeThemes}
            size={isHome ? 'lg' : 'sm'}
            submitLabel="Use this theme"
          />
        ) : null}
      </div>
    </div>
  )
}
