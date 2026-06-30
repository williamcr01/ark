import type { ChangeEvent, ReactNode } from 'react'
import {
  DownloadIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PresentationIcon,
  RefreshCwIcon,
  UploadIcon,
} from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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

export type DeckSaveStatus =
  'loading' | 'new' | 'generating' | 'saving' | 'dirty' | 'saved' | 'error'

export type AppTitleBarProps = {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  deckSaveStatus: DeckSaveStatus
  hasDeck: boolean
  hasSlides: boolean
  isChatOpen: boolean
  isGenerating: boolean
  isStripOpen: boolean
  onDownload: () => void
  onHtmlUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onReset: () => void
  onToggleChat: () => void
  onToggleStrip: () => void
  onUploadClick: () => void
}

export function AppTitleBar({
  fileInputRef,
  deckSaveStatus,
  hasDeck,
  hasSlides,
  isChatOpen,
  isGenerating,
  isStripOpen,
  onDownload,
  onHtmlUpload,
  onReset,
  onToggleChat,
  onToggleStrip,
  onUploadClick,
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
        <TitleBarButton disabled={!hasDeck || isGenerating} label="Start over" onClick={onReset}>
          <RefreshCwIcon />
        </TitleBarButton>
        <TitleBarButton disabled={!hasDeck} label="Download HTML" onClick={onDownload} primary>
          <DownloadIcon />
        </TitleBarButton>
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
