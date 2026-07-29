import { Link } from 'react-router'

import { Skeleton } from '@/components/ui/skeleton'
import { useDeckThumbnails } from '@/hooks/useDeckThumbnails'
import { cn } from '@/lib/utils'
import type { DeckSummary } from '@/lib/deck-api'

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

export function DeckCard({ deck }: { deck: DeckSummary }) {
  const { thumbnailUrls, isLoading, status } = useDeckThumbnails(deck.id, deck.activeVersionId, 1, {
    waitMs: 0,
  })
  const thumbnailUrl = thumbnailUrls?.[0] ?? null
  const showSkeleton = Boolean(deck.activeVersionId) && (isLoading || status === 'pending')
  const initial = (deck.title.trim().charAt(0) || 'A').toUpperCase()

  return (
    <Link
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl bg-card text-left ring-1 ring-foreground/10',
        'transition-[transform,box-shadow] duration-150',
        'hover:-translate-y-0.5 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      to={`/decks/${deck.id}`}
    >
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
            className="flex size-full items-center justify-center bg-muted text-3xl font-heading font-semibold text-muted-foreground"
          >
            {initial}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate font-heading text-sm font-medium leading-snug">{deck.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {formatUpdatedAt(deck.updatedAt)}
        </span>
      </div>
    </Link>
  )
}
