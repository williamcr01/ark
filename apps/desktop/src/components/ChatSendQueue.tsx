import { useState, type KeyboardEvent } from 'react'
import { PaperclipIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { QueuedChatSendPreview } from '@/lib/chat/chat-send-queue'

export type ChatSendQueueProps = {
  items: QueuedChatSendPreview[]
  onDismiss: (id: string) => void
  onEdit: (id: string, text: string) => void
  onSendAll: () => void
  onSendNow: (id: string) => void
}

function QueuedSendChip({
  item,
  onDismiss,
  onEdit,
  onSendNow,
}: {
  item: QueuedChatSendPreview
  onDismiss: (id: string) => void
  onEdit: (id: string, text: string) => void
  onSendNow: (id: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  const label = item.text.trim() || (item.attachmentCount > 0 ? 'Attachment' : 'Queued message')

  const commitEdit = () => {
    if (draft === null) {
      return
    }

    const next = draft.trim()
    if (next && next !== item.text) {
      onEdit(item.id, next)
    }
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
    }
  }

  return (
    <li className="flex min-w-0 items-center gap-1 rounded-lg border border-[var(--ark-line)] bg-[var(--ark-field)] px-2 py-1">
      {editing ? (
        <Input
          aria-label="Edit queued message"
          autoFocus
          className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none md:text-xs"
          onBlur={commitEdit}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          value={draft}
        />
      ) : (
        <button
          className="min-w-0 flex-1 truncate rounded-sm px-1 text-left text-xs text-foreground"
          onClick={() => setDraft(item.text)}
          title={label}
          type="button"
        >
          {label}
        </button>
      )}
      {item.attachmentCount > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <PaperclipIcon aria-hidden className="size-3" />
          {item.attachmentCount}
        </span>
      ) : null}
      <Button
        className="shrink-0"
        onClick={() => onSendNow(item.id)}
        size="xs"
        type="button"
        variant="ghost"
      >
        Send now
      </Button>
      <Button
        aria-label="Dismiss queued message"
        className="shrink-0"
        onClick={() => onDismiss(item.id)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </li>
  )
}

export function ChatSendQueue({
  items,
  onDismiss,
  onEdit,
  onSendAll,
  onSendNow,
}: ChatSendQueueProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="mb-2 flex flex-col gap-1.5 px-1" data-slot="chat-send-queue">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          {items.length === 1 ? '1 queued message' : `${items.length} queued messages`}
        </p>
        <Button onClick={onSendAll} size="xs" type="button" variant="outline">
          Send all
        </Button>
      </div>
      <ul aria-label="Queued messages" className="flex flex-col gap-1">
        {items.map((item) => (
          <QueuedSendChip
            item={item}
            key={item.id}
            onDismiss={onDismiss}
            onEdit={onEdit}
            onSendNow={onSendNow}
          />
        ))}
      </ul>
    </div>
  )
}
