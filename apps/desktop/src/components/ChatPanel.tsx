import { useMemo, type ReactNode } from 'react'

import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatGenerationStatus } from '@/components/chat/ChatGenerationStatus'
import { useChatInteractionLock } from '@/components/chat/chat-interaction-lock'
import { ChatInteractions } from '@/components/chat/ChatInteractions'
import {
  ChatPanelRuntimeContext,
  type ChatPanelLayout,
  type ChatPanelRuntime,
} from '@/components/chat/chat-panel-runtime'
import { ChatQueuedSends } from '@/components/chat/ChatQueuedSends'
import { ChatTranscript } from '@/components/chat/ChatTranscript'
import { Card, CardContent } from '@/components/ui/card'
import { useAppearance } from '@/hooks/useAppearance'
import { useMcpInteraction } from '@/hooks/useMcpInteraction'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePromptSubmit } from '@/hooks/usePromptSubmit'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { shouldShowLiveAssistant } from '@/lib/chat/chat-message-parts'
import { cn } from '@/lib/ui/utils'
import {
  selectActiveJobId,
  selectActiveSteps,
  selectGenerationStatus,
  useChatStore,
} from '@/state/chat-store.ts'
import { useShellStore } from '@/state/shell-store.ts'

export type { ChatMessage } from '@ark/chat/chat.ts'
export type { ChatPanelLayout }

export type ChatPanelProps = {
  layout?: ChatPanelLayout
  contextSlot?: ReactNode
}

export function ChatPanel({ layout = 'sidebar', contextSlot }: ChatPanelProps) {
  return (
    <ChatPanelRuntimeProvider contextSlot={contextSlot} layout={layout}>
      <ChatPanelFrame layout={layout} />
    </ChatPanelRuntimeProvider>
  )
}

function ChatPanelRuntimeProvider({
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

function useChatTranscriptVisibility(layout: ChatPanelLayout) {
  const messages = useChatStore((state) => state.messages)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const activeSteps = useChatStore(selectActiveSteps)
  const activeJobId = useChatStore(selectActiveJobId)
  const generationStatus = useChatStore(selectGenerationStatus)
  const showLiveAssistant = shouldShowLiveAssistant(
    messages,
    isGenerating,
    activeJobId,
    generationStatus,
    activeSteps.length,
  )
  return {
    isHome: layout === 'home',
    isEmpty: messages.length === 0 && !showLiveAssistant && !isGenerating,
    showLiveAssistant,
  }
}

function ChatPanelFrame({ layout }: { layout: ChatPanelLayout }) {
  const { isHome, isEmpty } = useChatTranscriptVisibility(layout)
  const { interactionActive, activeQuestions, activeThemes } = useChatInteractionLock()
  const hasInteraction = Boolean(activeQuestions || activeThemes)
  const isHomeEmpty = isHome && isEmpty && !hasInteraction && !interactionActive

  return (
    <Card
      className={cn(
        'flex h-full min-h-0 gap-0 rounded-none border-0 py-0 shadow-none ring-0 [--card-spacing:0]',
        isHome ? 'bg-transparent' : 'bg-[var(--ark-panel)]',
      )}
    >
      <CardContent
        className={cn('flex min-h-0 flex-1 flex-col p-0', isHomeEmpty && 'justify-center')}
      >
        {isHomeEmpty ? null : <ChatTranscript />}
        {hasInteraction ? <ChatInteractions /> : null}
        <div
          className={cn(
            'relative shrink-0',
            isHome
              ? isHomeEmpty
                ? 'bg-transparent px-1 py-2 sm:px-2'
                : 'bg-transparent px-1 pb-8 pt-2 sm:px-2'
              : 'bg-[var(--ark-paper)] p-4',
          )}
          data-slot="agent-composer"
        >
          <ChatGenerationStatus />
          <ChatQueuedSends />
          <ChatComposer />
        </div>
      </CardContent>
    </Card>
  )
}
