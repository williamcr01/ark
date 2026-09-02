import { LockIcon, LockOpenIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'

import { InspectorSection } from './InspectorField'

export function LockSection({
  busy,
  locked,
  onToggleLock,
}: {
  busy: boolean
  locked: boolean
  onToggleLock: () => void
}) {
  return (
    <InspectorSection title="State">
      <button
        aria-label={locked ? 'Unlock element' : 'Lock element'}
        className={cn(
          buttonVariants({ size: 'sm', variant: 'ghost' }),
          'h-6 justify-start gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] px-2 text-[11px] text-[var(--ark-titlebar-fg)] shadow-none',
          'hover:bg-[var(--ark-titlebar-hover)]',
          'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
        )}
        disabled={busy}
        onClick={onToggleLock}
        type="button"
      >
        {locked ? (
          <>
            <LockOpenIcon aria-hidden className="size-3.5" />
            Unlock element
          </>
        ) : (
          <>
            <LockIcon aria-hidden className="size-3.5" />
            Lock element
          </>
        )}
      </button>
    </InspectorSection>
  )
}
