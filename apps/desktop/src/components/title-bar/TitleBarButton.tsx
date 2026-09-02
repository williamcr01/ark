import { type ReactNode } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/ui/utils'

type TitleBarButtonConfig = {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick?: () => void
  primary?: boolean
  toggle?: boolean
} & Pick<React.ComponentProps<'button'>, 'aria-controls' | 'aria-expanded' | 'type'>

export function TitleBarButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
  primary = false,
  toggle = false,
  ...props
}: TitleBarButtonConfig) {
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
