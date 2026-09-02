import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'

export function TitleBarDeckTitle({
  activeDeckId,
  deckTitle,
  disabled,
  onRenameDeck,
}: {
  activeDeckId: string | null
  deckTitle: string
  disabled?: boolean
  onRenameDeck: (title: string) => Promise<void> | void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(deckTitle)
  const [isSaving, setIsSaving] = useState(false)
  const [editWidth, setEditWidth] = useState<number>()
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const skipCommitRef = useRef(false)
  const displayTitle = deckTitle || 'New deck'
  const canEdit = Boolean(activeDeckId) && !disabled
  const titleClassName = cn(
    'box-border h-7 min-w-0 max-w-48 rounded-sm border border-transparent px-1.5 text-xs font-medium text-[var(--ark-titlebar-fg)] shadow-none outline-none',
    'disabled:text-[var(--ark-titlebar-muted)]/50',
  )

  useEffect(() => {
    if (!isEditing) {
      return
    }

    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus()
    input.select()
  }, [isEditing])

  const startEditing = () => {
    setEditWidth(buttonRef.current?.offsetWidth)
    setDraftTitle(deckTitle)
    setIsEditing(true)
  }

  const cancelEditing = () => {
    skipCommitRef.current = true
    setDraftTitle(deckTitle)
    setIsEditing(false)
  }

  const commitRename = async () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }

    const nextTitle = draftTitle.trim()

    if (!activeDeckId || !nextTitle || nextTitle === deckTitle) {
      setDraftTitle(deckTitle)
      setIsEditing(false)
      return
    }

    setIsSaving(true)

    try {
      await onRenameDeck(nextTitle)
      setIsEditing(false)
    } catch {
      // Keep editing so the user can retry or cancel.
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      inputRef.current?.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }

  if (isEditing) {
    return (
      <input
        aria-label="Deck title"
        className={cn(titleClassName, 'bg-[var(--ark-titlebar-hover)] border-ring')}
        disabled={isSaving}
        onBlur={() => {
          void commitRename()
        }}
        onChange={(event) => setDraftTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        style={editWidth ? { width: editWidth } : undefined}
        value={draftTitle}
      />
    )
  }

  return (
    <button
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        titleClassName,
        'inline-flex justify-start hover:!bg-transparent dark:hover:!bg-transparent active:!translate-y-0',
      )}
      disabled={!canEdit}
      onClick={startEditing}
      ref={buttonRef}
      type="button"
    >
      <span className="min-w-0 truncate">{displayTitle}</span>
    </button>
  )
}
