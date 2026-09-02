import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/ui/utils'

export function AgentQuestionOptionRow({
  selected,
  multi,
  hint,
  disabled,
  children,
  onClick,
}: {
  selected: boolean
  multi?: boolean
  hint?: string
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
        'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-foreground/25 bg-muted/80' : 'border-border/80 bg-background/40',
        disabled && 'pointer-events-none opacity-50',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
          multi ? 'rounded-[4px]' : 'rounded-full',
          selected
            ? 'border-foreground bg-foreground text-background'
            : 'border-muted-foreground/40',
        )}
      >
        {selected ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1 whitespace-normal">{children}</span>
      {hint ? (
        <kbd className="text-muted-foreground mt-0.5 shrink-0 font-mono text-[10px]">{hint}</kbd>
      ) : null}
    </button>
  )
}
