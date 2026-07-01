import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  ChevronDownIcon,
  DownloadIcon,
  FilePlus2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PresentationIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DeckSummary } from '@/lib/deck-api'
import type { DeckDownloadVariant } from '@/lib/deck-export'
import { cn } from '@/lib/utils'

type TitleBarButtonProps = {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick?: () => void
  primary?: boolean
  toggle?: boolean
} & Pick<React.ComponentProps<'button'>, 'aria-controls' | 'aria-expanded' | 'type'>

function TitleBarButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
  primary = false,
  toggle = false,
  ...props
}: TitleBarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={toggle ? active : undefined}
          className={cn(
            buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
            'size-[26px] rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
            'hover:bg-[var(--ark-titlebar-hover)]',
            'disabled:text-[var(--ark-titlebar-muted)]/50',
            active && 'bg-[var(--ark-titlebar-active)]',
            primary && !disabled && 'text-[var(--ark-accent)] hover:bg-[var(--ark-accent-soft)]',
          )}
          disabled={disabled}
          onClick={onClick}
          type="button"
          {...props}
        >
          <span aria-hidden className="inline-flex">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function DownloadTitleBarButton({
  disabled,
  onDownload,
  showSanitizedDownload,
}: {
  disabled?: boolean
  onDownload: (variant: DeckDownloadVariant) => void
  showSanitizedDownload: boolean
}) {
  if (!showSanitizedDownload) {
    return (
      <TitleBarButton
        disabled={disabled}
        label="Download HTML"
        onClick={() => onDownload('original')}
        primary
      >
        <DownloadIcon />
      </TitleBarButton>
    )
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Download HTML"
              className={cn(
                buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
                'size-[26px] rounded-sm border-0 text-[var(--ark-accent)] shadow-none',
                'hover:bg-[var(--ark-accent-soft)]',
                'disabled:text-[var(--ark-titlebar-muted)]/50',
              )}
              disabled={disabled}
              type="button"
            >
              <span aria-hidden className="inline-flex">
                <DownloadIcon />
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Download HTML</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Export deck</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onDownload('original')}>
          <div className="flex flex-col gap-0.5">
            <span>Original HTML</span>
            <span className="text-xs text-muted-foreground">Keeps scripts and handlers</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDownload('sanitized')}>
          <div className="flex flex-col gap-0.5">
            <span>Sanitized HTML</span>
            <span className="text-xs text-muted-foreground">Matches static preview</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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

function DeckLibraryMenu({
  activeDeckId,
  deckTitle,
  decks,
  disabled,
  onDeleteDeck,
  onNewDeck,
  onRenameDeck,
  onSelectDeck,
}: {
  activeDeckId: string | null
  deckTitle: string
  decks: DeckSummary[]
  disabled?: boolean
  onDeleteDeck: () => Promise<void> | void
  onNewDeck: () => void
  onRenameDeck: (title: string) => Promise<void> | void
  onSelectDeck: (deckId: string) => Promise<void> | void
}) {
  const [renameError, setRenameError] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(deckTitle)
  const [isRenaming, setIsRenaming] = useState(false)
  const displayTitle = deckTitle || 'New deck'

  const handleRenameOpenChange = (open: boolean) => {
    setRenameOpen(open)

    if (open) {
      setRenameValue(deckTitle)
      setRenameError('')
    }
  }

  const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!activeDeckId) {
      return
    }

    setIsRenaming(true)
    setRenameError('')

    try {
      await onRenameDeck(renameValue)
      setRenameOpen(false)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Could not rename the deck.')
    } finally {
      setIsRenaming(false)
    }
  }

  const handleDelete = () => {
    if (!activeDeckId) {
      return
    }

    const confirmed = window.confirm(`Delete "${displayTitle}"? This cannot be undone.`)

    if (confirmed) {
      void onDeleteDeck()
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Select deck"
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'h-7 min-w-0 max-w-48 justify-start gap-1 rounded-sm border-0 px-1.5 text-xs font-medium text-[var(--ark-titlebar-fg)] shadow-none',
              'hover:bg-[var(--ark-titlebar-hover)]',
              'disabled:text-[var(--ark-titlebar-muted)]/50',
            )}
            disabled={disabled}
            type="button"
          >
            <span className="min-w-0 truncate">{displayTitle}</span>
            <ChevronDownIcon aria-hidden className="shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Saved decks</DropdownMenuLabel>
          <DropdownMenuGroup>
            {decks.length > 0 ? (
              decks.map((deck) => (
                <DropdownMenuItem
                  className="items-start"
                  disabled={deck.id === activeDeckId}
                  key={deck.id}
                  onSelect={() => {
                    void onSelectDeck(deck.id)
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{deck.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatUpdatedAt(deck.updatedAt)}
                    </span>
                  </div>
                  {deck.id === activeDeckId ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Active</span>
                  ) : null}
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No saved decks yet</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewDeck}>
            <FilePlus2Icon />
            New deck
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activeDeckId}
            onSelect={() => {
              handleRenameOpenChange(true)
            }}
          >
            <PencilIcon />
            Rename deck
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!activeDeckId} onSelect={handleDelete} variant="destructive">
            <Trash2Icon />
            Delete deck
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={handleRenameOpenChange} open={renameOpen}>
        <DialogContent>
          <form className="contents" onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>Rename deck</DialogTitle>
              <DialogDescription>Change the name shown in the deck list.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Input
                aria-invalid={Boolean(renameError)}
                autoFocus
                disabled={isRenaming}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder="Deck title"
                value={renameValue}
              />
              {renameError ? (
                <p className="text-xs text-destructive" role="alert">
                  {renameError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                disabled={isRenaming}
                onClick={() => setRenameOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={isRenaming} type="submit">
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export type DeckSaveStatus =
  'loading' | 'new' | 'generating' | 'saving' | 'dirty' | 'saved' | 'error'

export type AppTitleBarProps = {
  activeDeckId: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  deckTitle: string
  decks: DeckSummary[]
  deckSaveStatus: DeckSaveStatus
  hasDeck: boolean
  hasSlides: boolean
  isChatOpen: boolean
  isGenerating: boolean
  isStripOpen: boolean
  onDeleteDeck: () => Promise<void> | void
  onDownload: (variant: DeckDownloadVariant) => void
  onHtmlUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onNewDeck: () => void
  onRenameDeck: (title: string) => Promise<void> | void
  onSelectDeck: (deckId: string) => Promise<void> | void
  onToggleChat: () => void
  onToggleStrip: () => void
  onUploadClick: () => void
  showSanitizedDownload: boolean
}

export function AppTitleBar({
  activeDeckId,
  fileInputRef,
  deckTitle,
  decks,
  deckSaveStatus,
  hasDeck,
  hasSlides,
  isChatOpen,
  isGenerating,
  isStripOpen,
  onDeleteDeck,
  onDownload,
  onHtmlUpload,
  onNewDeck,
  onRenameDeck,
  onSelectDeck,
  onToggleChat,
  onToggleStrip,
  onUploadClick,
  showSanitizedDownload,
}: AppTitleBarProps) {
  const statusLabel =
    deckSaveStatus === 'loading'
      ? 'Restoring…'
      : deckSaveStatus === 'generating'
        ? 'Generating…'
        : deckSaveStatus === 'saving'
          ? 'Saving…'
          : deckSaveStatus === 'dirty'
            ? 'Unsaved changes'
            : deckSaveStatus === 'error'
              ? 'Save failed'
              : hasDeck
                ? 'Saved'
                : 'New deck'

  const statusTone =
    deckSaveStatus === 'loading' || deckSaveStatus === 'generating' || deckSaveStatus === 'saving'
      ? 'pending'
      : deckSaveStatus === 'dirty' || deckSaveStatus === 'error'
        ? 'warning'
        : hasDeck
          ? 'saved'
          : 'idle'
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-2 text-[var(--ark-titlebar-fg)]">
      <input
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={onHtmlUpload}
        ref={fileInputRef}
        type="file"
      />
      <div className="flex min-w-0 items-center gap-2 px-1">
        <PresentationIcon
          aria-hidden
          className="size-4 shrink-0 text-[var(--ark-titlebar-muted)]"
        />
        <span className="truncate text-[13px] leading-none">Ark</span>
        <span aria-hidden className="text-[var(--ark-titlebar-muted)]">
          ·
        </span>
        <DeckLibraryMenu
          activeDeckId={activeDeckId}
          deckTitle={deckTitle}
          decks={decks}
          disabled={isGenerating}
          onDeleteDeck={onDeleteDeck}
          onNewDeck={onNewDeck}
          onRenameDeck={onRenameDeck}
          onSelectDeck={onSelectDeck}
        />
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[var(--ark-titlebar-muted)]">
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              statusTone === 'pending' && 'animate-pulse bg-amber-500',
              statusTone === 'warning' && 'bg-amber-500',
              statusTone === 'saved' && 'bg-emerald-500',
              statusTone === 'idle' && 'bg-[var(--ark-titlebar-muted)]/50',
            )}
          />
          {statusLabel}
        </span>
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <ButtonGroup className="shrink-0">
        <TitleBarButton disabled={isGenerating} label="New deck" onClick={onNewDeck}>
          <FilePlus2Icon />
        </TitleBarButton>
        <DownloadTitleBarButton
          disabled={!hasDeck}
          onDownload={onDownload}
          showSanitizedDownload={showSanitizedDownload}
        />
        <TitleBarButton disabled={isGenerating} label="Upload HTML" onClick={onUploadClick}>
          <UploadIcon />
        </TitleBarButton>
        {hasSlides ? (
          <TitleBarButton
            active={isStripOpen}
            aria-controls="ark-slide-strip"
            aria-expanded={isStripOpen}
            label={isStripOpen ? 'Hide slide thumbnails' : 'Show slide thumbnails'}
            onClick={onToggleStrip}
            toggle
          >
            {isStripOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
          </TitleBarButton>
        ) : null}
        <ButtonGroupSeparator className="mx-0.5 h-4 bg-[var(--ark-titlebar-border)]" />
        <TitleBarButton
          active={isChatOpen}
          aria-controls="ark-chat-panel"
          aria-expanded={isChatOpen}
          label={isChatOpen ? 'Hide chat panel' : 'Show chat panel'}
          onClick={onToggleChat}
          toggle
        >
          {isChatOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
        </TitleBarButton>
      </ButtonGroup>
    </header>
  )
}
