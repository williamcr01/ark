import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  FilePlus2Icon,
  FileUpIcon,
  FolderOpenIcon,
  PresentationIcon,
  SettingsIcon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { DeckCard } from '@/components/DeckCard'
import { DesktopSettingsDialog } from '@/components/DesktopSettingsDialog'
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
import { clearStoredGenerationJob } from '@/hooks/useGenerationJob'
import { clearChatSession } from '@/lib/chat/chat-session'
import {
  createDeck,
  deleteDeck,
  importPptx,
  listDecks,
  locateWorkspace,
  openWorkspace,
  removeRecentWorkspace,
  renameDeck,
  type DeckSummary,
} from '@/lib/api/deck-api'
import {
  basenameFromPath,
  describeDeckValidation,
  fileToBase64,
  isHtmlDeckFile,
  isLegacyPptFile,
  isPptxFile,
  PPTX_LEGACY_UPLOAD_MESSAGE,
  validateUploadedDeck,
} from '@/lib/deck/deck-io'

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
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pptxFileInputRef = useRef<HTMLInputElement>(null)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { preference, setPreference } = useAppearance()

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

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handlePptxImportClick = useCallback(() => {
    pptxFileInputRef.current?.click()
  }, [])

  const handleNewDeck = useCallback(() => {
    clearChatSession(null)
    clearStoredGenerationJob(null)
    navigate('/decks/new')
  }, [navigate])

  const handleOpenWorkspace = useCallback(async () => {
    const path = await window.arkDesktop.files.openWorkspace()
    if (!path) return
    if (isPptxFile(path) || isLegacyPptFile(path)) {
      const filename = basenameFromPath(path)
      const pending = toast.loading('Importing PowerPoint...')
      try {
        const deck = await importPptx({ path, filename })
        toast.success(`Imported ${filename}`, { id: pending })
        navigate(`/decks/${deck.id}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not import that PowerPoint file',
          { id: pending },
        )
      }
      return
    }
    const deck = await openWorkspace(path)
    navigate(`/decks/${deck.id}`)
  }, [navigate])

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

        const deck = await createDeck(html)
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

  const handlePptxUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''

      if (!file) {
        return
      }

      if (isLegacyPptFile(file)) {
        toast.error(PPTX_LEGACY_UPLOAD_MESSAGE)
        return
      }

      if (!isPptxFile(file)) {
        toast.error('Import a .pptx file')
        return
      }

      setIsUploading(true)

      try {
        const deck = await importPptx({ filename: file.name, bytes: await fileToBase64(file) })
        toast.success(`Imported ${file.name}`)
        navigate(`/decks/${deck.id}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not import that PowerPoint file',
        )
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
          <input
            accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={handlePptxUpload}
            ref={pptxFileInputRef}
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
          <Button onClick={() => setSettingsOpen(true)} size="sm" variant="ghost">
            <SettingsIcon data-icon="inline-start" />
            Settings
          </Button>
          <Button disabled={isUploading} onClick={handleUploadClick} size="sm" variant="outline">
            <UploadIcon data-icon="inline-start" />
            Upload HTML
          </Button>
          <Button
            disabled={isUploading}
            onClick={handlePptxImportClick}
            size="sm"
            variant="outline"
          >
            <FileUpIcon data-icon="inline-start" />
            Import PowerPoint
          </Button>
          <Button onClick={() => void handleOpenWorkspace()} size="sm" variant="outline">
            <FolderOpenIcon data-icon="inline-start" />
            Open .ark
          </Button>
          <Button onClick={handleNewDeck} size="sm">
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
                  Create a deck with the agent, upload HTML, or import a PowerPoint file to get
                  started.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={handleNewDeck}>
                  <FilePlus2Icon data-icon="inline-start" />
                  New deck
                </Button>
                <Button disabled={isUploading} onClick={handleUploadClick} variant="outline">
                  <UploadIcon data-icon="inline-start" />
                  Upload HTML
                </Button>
                <Button disabled={isUploading} onClick={handlePptxImportClick} variant="outline">
                  <FileUpIcon data-icon="inline-start" />
                  Import PowerPoint
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
                  onLocate={handleLocate}
                  onRemoveRecent={handleRemoveRecent}
                />
              ))}
            </div>
          )}
        </main>
      </div>
      <DesktopSettingsDialog
        appearancePreference={preference}
        onAppearanceChange={setPreference}
        onCredentialsChanged={() => undefined}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
      />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
