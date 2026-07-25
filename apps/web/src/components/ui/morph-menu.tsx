import * as React from 'react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * Composer chips are `h-8`. Anchoring the panel with `side="top"` and a negative
 * offset of exactly that height lands its bottom edge on the trigger's bottom
 * edge, so the panel reads as the trigger expanding rather than as a detached
 * popup floating above it.
 */
export const MORPH_TRIGGER_HEIGHT = 32

/**
 * Trigger fades out under the open panel but keeps its layout box, so nothing
 * in the tools row shifts. `MorphMenuFooter` re-draws it as the panel's last row.
 */
export const morphMenuTriggerClassName =
  'ark-control! rounded-full transition-opacity data-[state=open]:pointer-events-none data-[state=open]:opacity-0'

export function MorphMenuContent({
  className,
  align = 'start',
  bare = false,
  side = 'top',
  sideOffset = -MORPH_TRIGGER_HEIGHT,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /**
   * Drop the panel surface so the caller can lay out several independently
   * sized cards (see the model picker's thinking-effort column).
   */
  bare?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        className={cn(
          'z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-32 origin-bottom-left flex-col p-0 text-[var(--ark-ink)] duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none',
          !bare && 'ark-control-panel! overflow-hidden rounded-lg bg-clip-padding',
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="morph-menu-content"
        side={side}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

/**
 * Mirrors the trigger as the panel's bottom row so the button never visually
 * disappears. Activating it collapses the panel back into the trigger.
 */
export function MorphMenuFooter({
  className,
  label,
  onCollapse,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick' | 'type'> & {
  label: string
  onCollapse: () => void
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'flex h-8 shrink-0 items-center gap-2 px-2.5 text-sm font-medium text-[var(--ark-ink)] outline-none',
        className,
      )}
      onClick={onCollapse}
      tabIndex={-1}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}
