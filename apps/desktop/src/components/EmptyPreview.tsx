import { WandSparklesIcon } from 'lucide-react'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useChatStore } from '@/state/chat-store.ts'

export function EmptyPreview() {
  const isGenerating = useChatStore((state) => state.isGenerating)
  const isPreviewUpdating = useChatStore((state) => state.isPreviewUpdating)
  const busy = isGenerating || isPreviewUpdating

  return (
    <Empty className="max-w-xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WandSparklesIcon />
        </EmptyMedia>
        <EmptyTitle>Set the stage</EmptyTitle>
        <EmptyDescription>
          {busy
            ? 'The agent is building your deck. Progress shows in the chat panel.'
            : 'Ask the agent to build a deck, or upload a self-contained HTML presentation from the command strip.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {busy ? (
          <span className="text-xs text-muted-foreground" role="status">
            {isPreviewUpdating ? 'Updating preview…' : 'Building your deck…'}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            Try: “Create a six-slide launch deck for a privacy-first notes app.”
          </span>
        )}
      </EmptyContent>
    </Empty>
  )
}
