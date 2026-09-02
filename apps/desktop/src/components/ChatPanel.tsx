import type { ReactNode } from 'react'

import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatGenerationStatus } from '@/components/chat/ChatGenerationStatus'
import { ChatInteractions, useChatInteractionLock } from '@/components/chat/ChatInteractions'
import { ChatQueuedSends } from '@/components/chat/ChatQueuedSends'
import { ChatTranscript, useChatTranscriptVisibility } from '@/components/chat/ChatTranscript'
import {
  ChatPanelRuntimeProvider,
  type ChatPanelLayout,
} from '@/components/chat/chat-panel-runtime'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/ui/utils'

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
