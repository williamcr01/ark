import { ChatQuestionsPanel } from '@/components/chat/ChatQuestionsPanel.tsx'
import { ChatThemesPanel } from '@/components/chat/ChatThemesPanel.tsx'
import { useChatInteractionLock } from '@/components/chat/chat-interaction-lock'
import { cn } from '@/lib/ui/utils'
import { useChatStore } from '@/state/chat-store.ts'

export function ChatInteractions() {
  const isGenerating = useChatStore((state) => state.isGenerating)
  const { layout, canGenerate, activeQuestions, activeThemes, mcpInteraction } =
    useChatInteractionLock()
  const isHome = layout === 'home'

  if (!activeQuestions && !activeThemes) {
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
        {activeQuestions ? (
          <ChatQuestionsPanel
            canGenerate={canGenerate}
            isGenerating={isGenerating}
            mcpInteraction={mcpInteraction}
            request={activeQuestions}
          />
        ) : null}
        {activeThemes ? (
          <ChatThemesPanel
            canGenerate={canGenerate}
            isGenerating={isGenerating}
            isHome={isHome}
            mcpInteraction={mcpInteraction}
            request={activeThemes}
          />
        ) : null}
      </div>
    </div>
  )
}
