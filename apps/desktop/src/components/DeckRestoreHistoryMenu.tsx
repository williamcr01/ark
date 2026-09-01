import { useState } from 'react'
import { HistoryIcon } from 'lucide-react'

import { listDocumentHistory, type DocumentHistorySummary } from '@/lib/api/deck-api'
import { DocumentHistoryRestoreList } from '@/components/DocumentHistoryRestoreList'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'

export type DeckRestoreHistoryMenuProps = {
  deckId: string | null
  disabled?: boolean
  onRestore: (revision: number) => Promise<void>
}

export function DeckRestoreHistoryMenu({
  deckId,
  disabled = false,
  onRestore,
}: DeckRestoreHistoryMenuProps) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<DocumentHistorySummary[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null)

  const loadHistory = async (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen || !deckId) {
      return
    }

    setLoadError('')
    setHistory(null)

    try {
      setHistory(await listDocumentHistory(deckId))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load document history.')
    }
  }

  const handleRestore = async (revision: number) => {
    setRestoringRevision(revision)
    try {
      await onRestore(revision)
      setOpen(false)
    } catch {
      // Parent surfaces the error; keep the list open so the user can retry.
    } finally {
      setRestoringRevision(null)
    }
  }

  return (
    <DropdownMenu onOpenChange={(nextOpen) => void loadHistory(nextOpen)} open={open}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              aria-label="Restore version"
              className={cn(
                buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
                'size-7 shrink-0 rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
                'hover:bg-[var(--ark-titlebar-hover)]',
                'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
              )}
              disabled={disabled || !deckId}
              type="button"
            >
              <span aria-hidden className="inline-flex">
                <HistoryIcon className="size-3.5" />
              </span>
            </button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">Restore version</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72 p-0" side="bottom">
        <DropdownMenuLabel className="px-2">Restore version</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loadError ? (
          <p className="px-2 py-3 text-xs text-destructive" role="alert">
            {loadError}
          </p>
        ) : history === null ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading versions…</p>
        ) : (
          <DocumentHistoryRestoreList
            history={history}
            onRestore={(revision) => void handleRestore(revision)}
            restoringRevision={restoringRevision}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
