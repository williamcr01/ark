import { useState, type ReactNode } from 'react'
import { CodeIcon, DownloadIcon, FileTextIcon, Maximize2Icon, PresentationIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button-variants'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DeckDownloadVariant, DeckExportFormat } from '@/lib/deck/deck-export'
import type { DeckHtmlExportLintEntry } from '@/lib/deck/export-lint'
import { cn } from '@/lib/ui/utils'

import { TitleBarButton } from './TitleBarButton'

export function TitleBarDeckActions({
  children,
  disabled,
  exportLint,
  exporting,
  hasSlides,
  isGenerating,
  onDownload,
  onExport,
  onPresent,
  showSanitizedDownload,
}: {
  children?: ReactNode
  disabled?: boolean
  exportLint: DeckHtmlExportLintEntry[]
  exporting: DeckExportFormat | false
  hasSlides: boolean
  isGenerating: boolean
  onDownload: (variant: DeckDownloadVariant) => void
  onExport: (format: DeckExportFormat) => void
  onPresent: () => void
  showSanitizedDownload: boolean
}) {
  return (
    <>
      <ExportTitleBarButton
        disabled={disabled}
        exportLint={exportLint}
        exporting={exporting}
        onDownload={onDownload}
        onExport={onExport}
        showSanitizedDownload={showSanitizedDownload}
      />
      {children}
      <TitleBarButton
        disabled={!hasSlides || isGenerating}
        label="Present fullscreen"
        onClick={onPresent}
        primary
      >
        <Maximize2Icon />
      </TitleBarButton>
    </>
  )
}

function ExportTitleBarButton({
  disabled,
  exportLint,
  exporting,
  onDownload,
  onExport,
  showSanitizedDownload,
}: {
  disabled?: boolean
  exportLint: DeckHtmlExportLintEntry[]
  exporting: DeckExportFormat | false
  onDownload: (variant: DeckDownloadVariant) => void
  onExport: (format: DeckExportFormat) => void
  showSanitizedDownload: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              aria-label="Export deck"
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
        <TooltipContent side="bottom">Export deck</TooltipContent>
      </Tooltip>
      <MorphMenuContent
        align="end"
        className="w-72"
        side="bottom"
        triggerHeight={26}
        triggerRadius={0}
      >
        <MorphMenuFooter
          className="h-[26px] justify-end px-1.5 text-[var(--ark-accent)]"
          label="Collapse export menu"
          onCollapse={() => setOpen(false)}
        >
          <DownloadIcon aria-hidden className="size-4" />
        </MorphMenuFooter>
        <div className="ark-scrollbar-none ark-morph-reveal min-h-0 overflow-y-auto p-1">
          <DropdownMenuLabel>Export deck</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={exporting !== false} onSelect={() => onExport('pdf')}>
              <FileTextIcon aria-hidden />
              <div className="flex flex-col gap-0.5">
                <span>{exporting === 'pdf' ? 'Exporting PDF...' : 'PDF'}</span>
                <span className="text-xs text-muted-foreground">Vector pages, selectable text</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={exporting !== false} onSelect={() => onExport('pptx')}>
              <PresentationIcon aria-hidden />
              <div className="flex flex-col gap-0.5">
                <span>{exporting === 'pptx' ? 'Exporting PowerPoint...' : 'PowerPoint'}</span>
                <span className="text-xs text-muted-foreground">Editable shapes and text</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {exportLint.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>PowerPoint export notes</DropdownMenuLabel>
              <ul className="text-muted-foreground space-y-1.5 px-2 py-1 text-[11px] leading-snug">
                {exportLint.map((item) => (
                  <li key={item.code}>{item.message}</li>
                ))}
              </ul>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => onDownload('original')}>
              <CodeIcon aria-hidden />
              <div className="flex flex-col gap-0.5">
                <span>Original HTML</span>
                <span className="text-xs text-muted-foreground">Keeps scripts and handlers</span>
              </div>
            </DropdownMenuItem>
            {showSanitizedDownload ? (
              <DropdownMenuItem onSelect={() => onDownload('sanitized')}>
                <CodeIcon aria-hidden />
                <div className="flex flex-col gap-0.5">
                  <span>Sanitized HTML</span>
                  <span className="text-xs text-muted-foreground">Matches static preview</span>
                </div>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </div>
      </MorphMenuContent>
    </DropdownMenu>
  )
}
