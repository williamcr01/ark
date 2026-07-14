import { useState } from 'react'
import { ChevronsUpDownIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  formatReasoningEffortLabel,
  REASONING_EFFORT_LEVELS,
  type ReasoningEffort,
} from '@/hooks/useReasoningEffort'
import { cn } from '@/lib/utils'

export type ReasoningEffortSelectorProps = {
  value: ReasoningEffort
  onValueChange: (effort: ReasoningEffort) => void
  disabled?: boolean
  className?: string
}

export function ReasoningEffortSelector({
  value,
  onValueChange,
  disabled = false,
  className,
}: ReasoningEffortSelectorProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label="Select reasoning effort"
          className={cn(
            'max-w-[140px] justify-between border-none bg-transparent font-medium text-muted-foreground shadow-none',
            'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
            className,
          )}
          disabled={disabled}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="truncate">{formatReasoningEffortLabel(value)}</span>
          <ChevronsUpDownIcon className="opacity-50" data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-44 border-[var(--ark-line)] bg-[var(--ark-paper)] p-0 text-[var(--ark-ink)] shadow-md"
        side="top"
        sideOffset={8}
      >
        <Command className="rounded-lg bg-transparent">
          <CommandList>
            <CommandGroup heading="Thinking effort">
              {REASONING_EFFORT_LEVELS.map((level) => {
                const isSelected = level.value === value

                return (
                  <CommandItem
                    data-checked={isSelected || undefined}
                    key={level.value}
                    onSelect={() => {
                      onValueChange(level.value)
                      setOpen(false)
                    }}
                    value={level.label}
                  >
                    <span className="font-medium text-[var(--ark-ink)]">{level.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
