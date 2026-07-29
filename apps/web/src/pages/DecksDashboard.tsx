import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  FilePlus2Icon,
  LaptopIcon,
  MoonIcon,
  PresentationIcon,
  SunIcon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { DeckCard } from '@/components/DeckCard'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { useAppearance, type AppearancePreference } from '@/hooks/useAppearance'
import {
  createDeck,
  deleteDeck,
  listDecks,
  renameDeck,
  type DeckSummary,
} from '@/lib/deck-api'
import { describeDeckValidation, isHtmlDeckFile, validateUploadedDeck } from '@/lib/deck-io'

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

function AppearanceControl({
  onChange,
  preference,
  resolvedAppearance,
}: {
  onChange: (preference: AppearancePreference) => void
  preference: AppearancePreference
  resolvedAppearance: 'light' | 'dark'
}) {
  const icon =
    preference === 'system' ? (
      <LaptopIcon data-icon="inline-start" />
    ) : resolvedAppearance === 'dark' ? (
      <MoonIcon data-icon="inline-start" />
    ) : (
      <SunIcon data-icon="inline-start" />
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          {icon}
          Theme
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          onValueChange={(value) => onChange(value as AppearancePreference)}
          value={preference}
        >
          <DropdownMenuRadioItem value="system">
            <LaptopIcon />
            System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <SunIcon />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon />
            Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DecksDashboard() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const { preference, resolvedAppearance, setPreference } = useAppearance()

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
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
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

  const handleHtmlUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''

      if (!file) {
        return
      }

      if (!isHtmlDeckFile(file)) {
        toast.error('Upload an .html file')
        return
      }

      setIsUploading(true)

      try {
        const html = await file.text()
        const validation = validateUploadedDeck(html)

        if (!validation.valid) {
          const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
          toast.error(primaryIssue?.message ?? 'That file does not look like a valid Ark HTML deck')
          return
        }

        const deck = await createDeck(html, {
          source: 'upload',
          summary: `Uploaded ${file.name}`,
        })
        toast.success(`Loaded ${file.name}. ${describeDeckValidation(validation)}.`)
        navigate(`/decks/${deck.id}`)
      } catch {
        toast.error('Could not upload that HTML file')
      } finally {
        setIsUploading(false)
      }
    },
    [navigate],
  )

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col overflow-y-auto bg-[var(--ark-canvas)] text-foreground">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--ark-panel-raised)] px-4">
          <input
            accept=".html,.htm,text/html"
            className="hidden"
            onChange={handleHtmlUpload}
            ref={fileInputRef}
            type="file"
          />
          <Link
            className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to="/decks"
          >
            <PresentationIcon aria-hidden className="size-4 shrink-0 text-[var(--ark-focus)]" />
            <span className="truncate font-heading text-[15px] font-semibold leading-none tracking-tight">
              Ark
            </span>
          </Link>
          <span className="text-sm text-muted-foreground">Decks</span>
          <div className="min-w-0 flex-1" aria-hidden />
          <AppearanceControl
            onChange={setPreference}
            preference={preference}
            resolvedAppearance={resolvedAppearance}
          />
          <Button disabled={isUploading} onClick={handleUploadClick} size="sm" variant="outline">
            <UploadIcon data-icon="inline-start" />
            Upload HTML
          </Button>
          <Button onClick={() => navigate('/decks/new')} size="sm">
            <FilePlus2Icon data-icon="inline-start" />
            New deck
          </Button>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Your decks</h1>
            <p className="text-sm text-muted-foreground">
              Open a deck to edit, or start a new one.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <DeckCardSkeleton key={index} />
              ))}
            </div>
          ) : decks.length === 0 ? (
            <Empty className="min-h-72 rounded-xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PresentationIcon />
                </EmptyMedia>
                <EmptyTitle>No decks yet</EmptyTitle>
                <EmptyDescription>
                  Create a deck with the agent, or upload an HTML file to get started.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => navigate('/decks/new')}>
                  <FilePlus2Icon data-icon="inline-start" />
                  New deck
                </Button>
                <Button disabled={isUploading} onClick={handleUploadClick} variant="outline">
                  <UploadIcon data-icon="inline-start" />
                  Upload HTML
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {decks.map((deck) => (
                <DeckCard
                  deck={deck}
                  key={deck.id}
                  onDelete={handleDeleteDeck}
                  onRename={handleRenameDeck}
                />
              ))}
            </div>
          )}
        </main>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
