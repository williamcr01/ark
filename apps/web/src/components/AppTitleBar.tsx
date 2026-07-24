import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  ChevronDownIcon,
  HistoryIcon,
  LaptopIcon,
  MoonIcon,
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
  SunIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DeckSummary, DeckVersionDetail, DeckVersionSummary } from '@/lib/deck-api'
import type { DeckDownloadVariant } from '@/lib/deck-export'
import { VersionHistoryDialog } from '@/components/VersionHistoryDialog'
import { cn } from '@/lib/utils'
import type { AppearancePreference, ResolvedAppearance } from '@/hooks/useAppearance'

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

function AppearanceMenu({
  preference,
  resolvedAppearance,
  onChange,
}: {
  preference: AppearancePreference
  resolvedAppearance: ResolvedAppearance
  onChange: (preference: AppearancePreference) => void
}) {
  const icon =
    preference === 'system' ? (
      <LaptopIcon />
    ) : resolvedAppearance === 'dark' ? (
      <MoonIcon />
    ) : (
      <SunIcon />
    )

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Appearance" className="h-7 px-2 text-xs" size="sm" variant="ghost">
              {icon}
              Theme
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Appearance</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
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
  appearancePreference?: AppearancePreference
  resolvedAppearance?: ResolvedAppearance
  activeDeckId: string | null
  activeVersionId: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  deckTitle: string
  decks: DeckSummary[]
  deckSaveStatus: DeckSaveStatus
  hasDeck: boolean
  hasSlides: boolean
  isChatOpen: boolean
  isGenerating: boolean
  isLoadingVersions: boolean
  isStripOpen: boolean
  onClearVersionPreview: () => void
  onAppearanceChange?: (preference: AppearancePreference) => void
  onDeleteDeck: () => Promise<void> | void
  onDownload: (variant: DeckDownloadVariant) => void
  onHtmlUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onInspectVersion: (versionId: string) => Promise<DeckVersionDetail | null>
  onNewDeck: () => void
  onRefreshVersions: () => Promise<DeckVersionSummary[]>
  onRenameDeck: (title: string) => Promise<void> | void
  onRollbackVersion: (versionId: string) => Promise<void>
  onSelectDeck: (deckId: string) => Promise<void> | void
  onToggleChat: () => void
  onToggleStrip: () => void
  onUploadClick: () => void
  previewVersion: DeckVersionDetail | null
  showSanitizedDownload: boolean
  versionNumber: number | null
  versions: DeckVersionSummary[]
}

export function AppTitleBar({
  appearancePreference = 'system',
  resolvedAppearance = 'dark',
  activeDeckId,
  activeVersionId,
  fileInputRef,
  deckTitle,
  decks,
  deckSaveStatus,
  hasDeck,
  hasSlides,
  isChatOpen,
  isGenerating,
  isLoadingVersions,
  isStripOpen,
  onClearVersionPreview,
  onAppearanceChange = () => undefined,
  onDeleteDeck,
  onDownload,
  onHtmlUpload,
  onInspectVersion,
  onNewDeck,
  onRefreshVersions,
  onRenameDeck,
  onRollbackVersion,
  onSelectDeck,
  onToggleChat,
  onToggleStrip,
  onUploadClick,
  previewVersion,
  showSanitizedDownload,
  versionNumber,
  versions,
}: AppTitleBarProps) {
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
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

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-[var(--ark-panel-raised)] px-2 text-foreground">
      <input
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={onHtmlUpload}
        ref={fileInputRef}
        type="file"
      />
      <div className="flex min-w-0 items-center gap-2 px-1">
        <PresentationIcon aria-hidden className="size-4 shrink-0 text-[var(--ark-focus)]" />
        <span className="truncate font-heading text-[15px] font-semibold leading-none tracking-tight">
          Ark
        </span>
        <span aria-hidden className="text-muted-foreground">
          /
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
        <Badge
          variant={
            deckSaveStatus === 'error'
              ? 'destructive'
              : deckSaveStatus === 'dirty'
                ? 'outline'
                : 'secondary'
          }
        >
          {statusLabel}
          {versionNumber ? <span>· v{versionNumber}</span> : null}
        </Badge>
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <ButtonGroup className="shrink-0">
        <AppearanceMenu
          onChange={onAppearanceChange}
          preference={appearancePreference}
          resolvedAppearance={resolvedAppearance}
        />
        <TitleBarButton
          disabled={!activeDeckId || isGenerating}
          label="Version history"
          onClick={() => setVersionHistoryOpen(true)}
        >
          <HistoryIcon />
        </TitleBarButton>
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

      <VersionHistoryDialog
        activeVersionId={activeVersionId}
        deckTitle={deckTitle}
        disabled={isGenerating}
        isLoadingVersions={isLoadingVersions}
        onClearPreview={onClearVersionPreview}
        onInspectVersion={onInspectVersion}
        onOpenChange={setVersionHistoryOpen}
        onRefreshVersions={onRefreshVersions}
        onRollback={onRollbackVersion}
        open={versionHistoryOpen}
        previewVersion={previewVersion}
        versions={versions}
      />
    </header>
  )
}
