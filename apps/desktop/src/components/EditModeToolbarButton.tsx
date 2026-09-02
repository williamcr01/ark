import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'

type ToolbarButtonProps = {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  shortcuts?: string
  onClick?: () => void
  toggle?: boolean
}

export function ToolbarButton({
  active = false,
  children,
  disabled = false,
  label,
  shortcuts,
  onClick,
  toggle = false,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-keyshortcuts={shortcuts}
          aria-label={label}
          aria-pressed={toggle ? active : undefined}
          className={cn(
            buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
            'size-7 shrink-0 rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
            'hover:bg-[var(--ark-titlebar-hover)]',
            'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
            active && 'bg-[var(--ark-titlebar-active)] text-[var(--ark-accent)]',
          )}
          disabled={disabled}
          onClick={onClick}
          type="button"
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
