import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { DeckSummary } from '@/lib/api/deck-api'

export function DeckCardMedia({
  deck,
  initial,
  onLocate,
  onRemoveRecent,
  showSkeleton,
  thumbnailUrl,
}: {
  deck: DeckSummary
  initial: string
  onLocate?: (deck: DeckSummary) => void | Promise<void>
  onRemoveRecent?: (deck: DeckSummary) => void | Promise<void>
  showSkeleton: boolean
  thumbnailUrl: string | null
}) {
  return (
    <>
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
    </>
  )
}
