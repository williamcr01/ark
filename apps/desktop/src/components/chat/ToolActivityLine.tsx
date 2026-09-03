import { cn } from '@/lib/ui/utils'
import { formatToolLabel } from '@/lib/chat/chat-message-parts'
import type { IndexedToolPart } from '@/lib/chat/chat-message-parts'

export function ToolActivityLine({ part }: { part: IndexedToolPart['part'] }) {
  const error = part.type === 'tool-result' && part.error

  return (
    <div
      className={cn(
        'text-xs leading-relaxed',
        error ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span className={cn('font-medium', !error && 'text-foreground')}>
        {formatToolLabel(part.toolName)}
      </span>
      {part.summary ? <span> — {part.summary}</span> : null}
    </div>
  )
}
