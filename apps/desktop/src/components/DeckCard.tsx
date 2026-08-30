import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeckThumbnails } from '@/hooks/useDeckThumbnails'
import { cn } from '@/lib/ui/utils'
import type { DeckSummary } from '@/lib/api/deck-api'

function formatUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt)

  if (Number.isNaN(date.getTime())) {
    return 'Updated recently'
  }

  return `Updated ${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`
}

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
      {deck.missing ? (
        <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-muted p-4 text-center">
          <span className="text-sm text-muted-foreground">File not found</span>
          <div className="flex gap-2">
            <Button className="relative z-20" onClick={() => void onLocate?.(deck)} size="sm">
              Locate
            </Button>
            <Button
              className="relative z-20"
              onClick={() => void onRemoveRecent?.(deck)}
              size="sm"
              variant="outline"
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {thumbnailUrl ? (
            <img
              alt=""
              className="size-full object-cover"
              decoding="async"
              loading="lazy"
              src={thumbnailUrl}
            />
          ) : showSkeleton ? (
            <Skeleton className="size-full rounded-none" />
          ) : (
            <div
              aria-hidden
              className="flex size-full items-center justify-center bg-muted font-heading text-3xl font-semibold text-muted-foreground"
            >
              {initial}
            </div>
          )}
        </div>
      )}

      {!deck.missing ? (
        <Link
          aria-label={`Open ${deck.title}`}
          className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/decks/${deck.id}`}
        />
      ) : null}

      <div className="flex items-start gap-1 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {isEditing ? (
            <input
              aria-label="Deck title"
              className="relative z-20 box-border h-5 w-full min-w-0 truncate rounded-sm border border-ring bg-transparent px-0 font-heading text-sm font-medium leading-5 outline-none"
              disabled={isSaving}
              onBlur={() => {
                void commitRename()
              }}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={handleTitleKeyDown}
              ref={inputRef}
              value={draftTitle}
            />
          ) : deck.missing ? (
            <span className="box-border flex h-5 w-full min-w-0 items-center truncate rounded-sm border border-transparent font-heading text-sm font-medium leading-5">
              {deck.title}
            </span>
          ) : (
            <span className="box-border flex h-5 w-full min-w-0 items-center truncate rounded-sm border border-transparent font-heading text-sm font-medium leading-5">
              {deck.title}
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {formatUpdatedAt(deck.updatedAt)}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Actions for ${deck.title}`}
              className="relative z-20 size-7 shrink-0"
              size="icon-sm"
              variant="ghost"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!focusTitleOnMenuCloseRef.current) {
                return
              }

              // Keep focus on the title input instead of returning to the ⋯ trigger.
              event.preventDefault()
              focusTitleOnMenuCloseRef.current = false
              inputRef.current?.focus()
              inputRef.current?.select()
            }}
          >
            <DropdownMenuItem disabled={deck.missing} onSelect={startRename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={deck.missing} onSelect={handleDelete} variant="destructive">
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
