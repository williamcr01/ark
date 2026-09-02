import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { useDeckThumbnails } from '@/hooks/useDeckThumbnails'
import { cn } from '@/lib/ui/utils'
import type { DeckSummary } from '@/lib/api/deck-api'

import { DeckCardMedia } from './DeckCardMedia.tsx'
import { formatUpdatedAt } from './deck-card-format.ts'
import { DeckCardMenu, DeckCardTitleField } from './DeckCardMenu.tsx'

export type DeckCardProps = {
  deck: DeckSummary
  onDelete: (deck: DeckSummary) => void | Promise<void>
  onRename: (deck: DeckSummary, title: string) => void | Promise<void>
  onLocate?: (deck: DeckSummary) => void | Promise<void>
  onRemoveRecent?: (deck: DeckSummary) => void | Promise<void>
}

export function DeckCard({ deck, onDelete, onRename, onLocate, onRemoveRecent }: DeckCardProps) {
  const { thumbnailUrls, isLoading, status } = useDeckThumbnails(
    deck.id,
    deck.documentRevision,
    1,
    {
      waitMs: 0,
    },
  )
  const thumbnailUrl = thumbnailUrls?.[0] ?? deck.cover ?? null
  const showSkeleton = !deck.missing && (isLoading || status === 'pending')
  const initial = (deck.title.trim().charAt(0) || 'A').toUpperCase()

  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(deck.title)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipCommitRef = useRef(false)
  const focusTitleOnMenuCloseRef = useRef(false)

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

  const startRename = () => {
    skipCommitRef.current = false
    focusTitleOnMenuCloseRef.current = true
    setDraftTitle(deck.title)
    setIsEditing(true)
  }

  const cancelRename = () => {
    skipCommitRef.current = true
    setDraftTitle(deck.title)
    setIsEditing(false)
  }

  const commitRename = async () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }

    const nextTitle = draftTitle.trim()

    if (!nextTitle || nextTitle === deck.title) {
      setDraftTitle(deck.title)
      setIsEditing(false)
      return
    }

    setIsSaving(true)

    try {
      await onRename(deck, nextTitle)
      setIsEditing(false)
    } catch {
      // Keep editing so the user can retry or cancel.
    } finally {
      setIsSaving(false)
    }
  }

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      inputRef.current?.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename()
    }
  }

  const handleDelete = () => {
    const confirmed = window.confirm(`Delete "${deck.title}"? This cannot be undone.`)

    if (confirmed) {
      void onDelete(deck)
    }
  }

  return (
    <article
      className={cn(
        'relative flex flex-col overflow-hidden rounded-xl bg-card text-left ring-1 ring-foreground/10',
        'transition-[transform,box-shadow] duration-150',
        'hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <DeckCardMedia
        deck={deck}
        initial={initial}
        onLocate={onLocate}
        onRemoveRecent={onRemoveRecent}
        showSkeleton={showSkeleton}
        thumbnailUrl={thumbnailUrl}
      />

      <div className="flex items-start gap-1 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DeckCardTitleField
            deck={deck}
            draftTitle={draftTitle}
            inputRef={inputRef}
            isEditing={isEditing}
            isSaving={isSaving}
            onBlur={() => {
              void commitRename()
            }}
            onChange={setDraftTitle}
            onKeyDown={handleTitleKeyDown}
          />
          <span className="truncate text-xs text-muted-foreground">
            {formatUpdatedAt(deck.updatedAt)}
          </span>
        </div>

        <DeckCardMenu
          deck={deck}
          focusTitleOnMenuCloseRef={focusTitleOnMenuCloseRef}
          inputRef={inputRef}
          onDelete={handleDelete}
          onRename={startRename}
        />
      </div>
    </article>
  )
}
