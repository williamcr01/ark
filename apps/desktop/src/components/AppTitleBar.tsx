import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router'
import {
  Maximize2Icon,
  DownloadIcon,
  FilePlus2Icon,
  FolderOpenIcon,
  FolderInputIcon,
  CopyIcon,
  Share2Icon,
  MapPinIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
  PresentationIcon,
  SettingsIcon,
  UploadIcon,
} from 'lucide-react'

import { buttonVariants } from '@/components/ui/button-variants'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MorphMenuContent,
  MorphMenuFooter,
  morphMenuTriggerMotionClassName,
} from '@/components/ui/morph-menu'
import type { DeckDownloadVariant } from '@/lib/deck-export'
import { DesktopSettingsDialog } from '@/components/DesktopSettingsDialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppearancePreference } from '@/hooks/useAppearance'

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
            'hover:!bg-transparent dark:hover:!bg-transparent active:!translate-y-0',
            'aria-expanded:!bg-transparent aria-expanded:!text-[var(--ark-titlebar-fg)]',
            'disabled:text-[var(--ark-titlebar-muted)]/50',
            active && 'bg-[var(--ark-titlebar-active)]',
            primary && !disabled && 'text-[var(--ark-accent)] hover:!text-[var(--ark-accent)]',
            !primary && !disabled && 'hover:!text-[var(--ark-titlebar-fg)]',
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
  const [open, setOpen] = useState(false)

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
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              aria-label="Download HTML"
              className={cn(
                buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
                morphMenuTriggerMotionClassName,
                'size-[26px] rounded-sm border-0 text-[var(--ark-accent)] shadow-none',
                'hover:!bg-transparent hover:!text-[var(--ark-accent)] dark:hover:!bg-transparent active:!translate-y-0',
                'aria-expanded:!bg-transparent aria-expanded:!text-[var(--ark-accent)]',
                'disabled:text-[var(--ark-titlebar-muted)]/50',
              )}
              disabled={disabled}
              type="button"
            >
              <span aria-hidden className="inline-flex">
                <DownloadIcon />
              </span>
            </button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">Download HTML</TooltipContent>
      </Tooltip>
      <MorphMenuContent
        align="end"
        className="w-64"
        side="bottom"
        triggerHeight={26}
        triggerRadius={0}
      >
        <MorphMenuFooter
          className="h-[26px] justify-end px-1.5 text-[var(--ark-accent)]"
          label="Collapse download menu"
          onCollapse={() => setOpen(false)}
        >
          <DownloadIcon aria-hidden className="size-4" />
        </MorphMenuFooter>
        <div className="ark-scrollbar-none ark-morph-reveal min-h-0 overflow-y-auto p-1">
          <DropdownMenuLabel>Export deck</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
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
          </DropdownMenuGroup>
        </div>
      </MorphMenuContent>
    </DropdownMenu>
  )
}

function DeckTitleEditor({
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

export type AppTitleBarProps = {
  appearancePreference?: AppearancePreference
  activeDeckId: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  deckTitle: string
  hasDeck: boolean
  hasSlides: boolean
  isChatOpen: boolean
  isGenerating: boolean
  isStripOpen: boolean
  onPresent: () => void
  onAppearanceChange?: (preference: AppearancePreference) => void
  onDownload: (variant: DeckDownloadVariant) => void
  onHtmlUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onCredentialsChanged?: () => void | Promise<void>
  onNewDeck: () => void
  onOpenWorkspace: () => void
  onSaveAs: () => void
  onMove: () => void
  onReveal: () => void
  onDuplicate: () => void
  onShareProject: () => void
  onRenameDeck: (title: string) => Promise<void> | void
  onToggleChat: () => void
  onToggleStrip: () => void
  onUploadClick: () => void
  showSanitizedDownload: boolean
}

export function AppTitleBar({
  appearancePreference = 'system',
  activeDeckId,
  fileInputRef,
  deckTitle,
  hasDeck,
  hasSlides,
  isChatOpen,
  isGenerating,
  isStripOpen,
  onAppearanceChange = () => undefined,
  onDownload,
  onHtmlUpload,
  onCredentialsChanged = () => undefined,
  onNewDeck,
  onOpenWorkspace,
  onSaveAs,
  onMove,
  onReveal,
  onDuplicate,
  onShareProject,
  onPresent,
  onRenameDeck,
  onToggleChat,
  onToggleStrip,
  onUploadClick,
  showSanitizedDownload,
}: AppTitleBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-[var(--ark-panel-raised)] px-2 text-foreground">
      <input
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={onHtmlUpload}
        ref={fileInputRef}
        type="file"
      />
      {hasSlides ? (
        <ButtonGroup className="shrink-0">
          <TitleBarButton
            aria-controls="ark-slide-strip"
            aria-expanded={isStripOpen}
            label={isStripOpen ? 'Hide slide thumbnails' : 'Show slide thumbnails'}
            onClick={onToggleStrip}
          >
            {isStripOpen ? <PanelLeftCloseIcon /> : <PanelLeftIcon />}
          </TitleBarButton>
        </ButtonGroup>
      ) : null}
      <div className="flex min-w-0 items-center gap-2 px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              aria-label="All decks"
              className="inline-flex shrink-0 items-center rounded-sm text-[var(--ark-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to="/decks"
            >
              <PresentationIcon aria-hidden className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">All decks</TooltipContent>
        </Tooltip>
        <Link
          className="truncate font-heading text-[15px] font-semibold leading-none tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to="/decks"
        >
          Ark
        </Link>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <DeckTitleEditor
          activeDeckId={activeDeckId}
          deckTitle={deckTitle}
          disabled={isGenerating}
          onRenameDeck={onRenameDeck}
        />
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <ButtonGroup className="shrink-0">
        <TitleBarButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </TitleBarButton>
        <TitleBarButton disabled={isGenerating} label="New deck" onClick={onNewDeck}>
          <FilePlus2Icon />
        </TitleBarButton>
        <TitleBarButton
          disabled={isGenerating}
          label="Open Ark workspace"
          onClick={onOpenWorkspace}
        >
          <FolderOpenIcon />
        </TitleBarButton>
        <TitleBarButton disabled={!activeDeckId || isGenerating} label="Save As" onClick={onSaveAs}>
          <CopyIcon />
        </TitleBarButton>
        <TitleBarButton
          disabled={!activeDeckId || isGenerating}
          label="Move workspace"
          onClick={onMove}
        >
          <FolderInputIcon />
        </TitleBarButton>
        <TitleBarButton disabled={!activeDeckId} label="Reveal in file manager" onClick={onReveal}>
          <MapPinIcon />
        </TitleBarButton>
        <TitleBarButton
          disabled={!activeDeckId || isGenerating}
          label="Duplicate presentation"
          onClick={onDuplicate}
        >
          <CopyIcon />
        </TitleBarButton>
        <TitleBarButton
          disabled={!activeDeckId || isGenerating}
          label="Share Ark Project"
          onClick={onShareProject}
        >
          <Share2Icon />
        </TitleBarButton>
        <DownloadTitleBarButton
          disabled={!hasDeck}
          onDownload={onDownload}
          showSanitizedDownload={showSanitizedDownload}
        />
        <TitleBarButton disabled={isGenerating} label="Upload HTML" onClick={onUploadClick}>
          <UploadIcon />
        </TitleBarButton>
        <TitleBarButton
          disabled={!hasSlides || isGenerating}
          label="Present fullscreen"
          onClick={onPresent}
          primary
        >
          <Maximize2Icon />
        </TitleBarButton>
        <TitleBarButton
          aria-controls="ark-chat-panel"
          aria-expanded={isChatOpen}
          label={isChatOpen ? 'Hide chat panel (Ctrl/⌘B)' : 'Show chat panel (Ctrl/⌘B)'}
          onClick={onToggleChat}
        >
          {isChatOpen ? <PanelRightCloseIcon /> : <PanelRightIcon />}
        </TitleBarButton>
      </ButtonGroup>

      <DesktopSettingsDialog
        appearancePreference={appearancePreference}
        onAppearanceChange={onAppearanceChange}
        onCredentialsChanged={onCredentialsChanged}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
      />
    </header>
  )
}
