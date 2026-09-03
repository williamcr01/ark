import { useCallback, useEffect, useState } from 'react'
import { FilePlus2Icon, FileUpIcon, PresentationIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AppTitleBar } from '@/components/AppTitleBar'
import { DeckCard } from '@/components/DeckCard'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearance } from '@/hooks/useAppearance'
import { useDashboardFileActions } from '@/hooks/useDashboardFileActions'
import {
  deleteDeck,
  listDecks,
  locateWorkspace,
  removeRecentWorkspace,
  renameDeck,
  type DeckSummary,
} from '@/lib/api/deck-api'

function DeckCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}

export function DecksDashboard() {
  const fileActions = useDashboardFileActions()
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  useAppearance()

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setError('')

      try {
        const nextDecks = await listDecks()

        if (!cancelled) {
          setDecks(nextDecks)
        }
      } catch {
        if (!cancelled) {
          setDecks([])
          setError('Could not load decks.')
        }
      } finally {
        setIsLoading((current) => (cancelled ? current : false))
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const handleRenameDeck = useCallback(async (deck: DeckSummary, title: string) => {
    try {
      const updated = await renameDeck(deck.id, title)
      setDecks((current) =>
        current.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)),
      )
      toast.success('Deck renamed')
    } catch {
      toast.error('Could not rename deck')
      throw new Error('Could not rename deck')
    }
  }, [])

  const handleDeleteDeck = useCallback(async (deck: DeckSummary) => {
    try {
      await deleteDeck(deck.id)
      setDecks((current) => current.filter((entry) => entry.id !== deck.id))
      toast.success('Deck deleted')
    } catch {
      toast.error('Could not delete deck')
    }
  }, [])

  const handleLocate = useCallback(async (deck: DeckSummary) => {
    const path = await window.arkDesktop.files.openWorkspace()
    if (!path) return
    const located = await locateWorkspace(deck.id, path)
    setDecks((current) =>
      current.map((item) => (item.id === deck.id ? { ...item, ...located, missing: false } : item)),
    )
  }, [])

  const handleRemoveRecent = useCallback(async (deck: DeckSummary) => {
    try {
      await removeRecentWorkspace(deck.id)
      setDecks((current) => current.filter((item) => item.id !== deck.id))
    } catch {
      toast.error('Could not remove recent workspace')
    }
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col overflow-y-auto bg-[var(--ark-canvas)] text-foreground">
        <AppTitleBar fileActions={fileActions} variant="library" />

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Slides</h1>
            <p className="text-sm text-muted-foreground">
              Open a presentation to edit, or start a new one from New.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <DashboardDeckList
            decks={decks}
            fileActions={fileActions}
            isLoading={isLoading}
            onDelete={handleDeleteDeck}
            onLocate={handleLocate}
            onRemoveRecent={handleRemoveRecent}
            onRename={handleRenameDeck}
          />
        </main>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

function DashboardDeckList({
  decks,
  fileActions,
  isLoading,
  onDelete,
  onLocate,
  onRemoveRecent,
  onRename,
}: {
  decks: DeckSummary[]
  fileActions: ReturnType<typeof useDashboardFileActions>
  isLoading: boolean
  onDelete: (deck: DeckSummary) => void | Promise<void>
  onLocate: (deck: DeckSummary) => void | Promise<void>
  onRemoveRecent: (deck: DeckSummary) => void | Promise<void>
  onRename: (deck: DeckSummary, title: string) => void | Promise<void>
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <DeckCardSkeleton key={index} />
        ))}
      </div>
    )
  }

  if (decks.length === 0) {
    return (
      <Empty className="min-h-72 rounded-xl border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PresentationIcon />
          </EmptyMedia>
          <EmptyTitle>No decks yet</EmptyTitle>
          <EmptyDescription>
            Create a deck with the agent, upload HTML, or import a PowerPoint file to get started.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={fileActions.handleNewDeck}>
            <FilePlus2Icon data-icon="inline-start" />
            New deck
          </Button>
          <Button
            disabled={fileActions.isUploading}
            onClick={fileActions.handleUploadClick}
            variant="outline"
          >
            <UploadIcon data-icon="inline-start" />
            Upload HTML
          </Button>
          <Button
            disabled={fileActions.isUploading}
            onClick={fileActions.handlePptxImportClick}
            variant="outline"
          >
            <FileUpIcon data-icon="inline-start" />
            Import PowerPoint
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {decks.map((deck) => (
        <DeckCard
          deck={deck}
          key={deck.id}
          onDelete={onDelete}
          onRename={onRename}
          onLocate={onLocate}
          onRemoveRecent={onRemoveRecent}
        />
      ))}
    </div>
  )
}
