import type { KeyboardEvent, RefObject } from 'react'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DeckSummary } from '@/lib/api/deck-api'

export function DeckCardTitleField({
  deck,
  draftTitle,
  inputRef,
  isEditing,
  isSaving,
  onBlur,
  onChange,
  onKeyDown,
}: {
  deck: DeckSummary
  draftTitle: string
  inputRef: RefObject<HTMLInputElement | null>
  isEditing: boolean
  isSaving: boolean
  onBlur: () => void
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  if (isEditing) {
    return (
      <input
        aria-label="Deck title"
        className="relative z-20 box-border h-5 w-full min-w-0 truncate rounded-sm border border-ring bg-transparent px-0 font-heading text-sm font-medium leading-5 outline-none"
        disabled={isSaving}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        ref={inputRef}
        value={draftTitle}
      />
    )
  }

  return (
    <span className="box-border flex h-5 w-full min-w-0 items-center truncate rounded-sm border border-transparent font-heading text-sm font-medium leading-5">
      {deck.title}
    </span>
  )
}

export function DeckCardMenu({
  deck,
  focusTitleOnMenuCloseRef,
  inputRef,
  onDelete,
  onRename,
}: {
  deck: DeckSummary
  focusTitleOnMenuCloseRef: RefObject<boolean>
  inputRef: RefObject<HTMLInputElement | null>
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Actions for ${deck.title}`}
          className="relative z-20 size-7 shrink-0"
          size="icon-sm"
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!focusTitleOnMenuCloseRef.current) {
            return
          }

          event.preventDefault()
          focusTitleOnMenuCloseRef.current = false
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
      >
        <DropdownMenuItem disabled={deck.missing} onSelect={onRename}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled={deck.missing} onSelect={onDelete} variant="destructive">
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
