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
export const morphMenuTriggerMotionClassName = 'ark-morph-trigger!'
export const morphMenuTriggerClassName = `ark-control-flat! ${morphMenuTriggerMotionClassName} rounded-full`

export const morphMenuSurfaceClassName = 'ark-morph-surface'

export function MorphMenuContent({
  className,
  align = 'start',
  bare = false,
  side = 'top',
  triggerHeight = MORPH_TRIGGER_HEIGHT,
  triggerRadius = triggerHeight / 2,
  sideOffset = -triggerHeight,
  collisionPadding = 8,
  style,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /**
   * Drop the panel surface so the caller can lay out several independently
   * sized cards (see the model picker's thinking-effort column).
   */
  bare?: boolean
  triggerHeight?: number
  triggerRadius?: number | string
}) {
  const resolvedTriggerRadius =
    typeof triggerRadius === 'number' ? `${triggerRadius}px` : triggerRadius

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        className={cn(
          'group z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-32 origin-bottom-left flex-col p-0 text-[var(--ark-ink)]',
          bare ? 'ark-morph-presence' : morphMenuSurfaceClassName,
          !bare && 'ark-control-panel! overflow-hidden rounded-lg bg-clip-padding',
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="morph-menu-content"
        side={side}
        sideOffset={sideOffset}
        style={
          {
            '--ark-morph-trigger-height': `${triggerHeight}px`,
            '--ark-morph-trigger-radius': resolvedTriggerRadius,
            ...style,
          } as React.CSSProperties
        }
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

export function MorphMenuWing({
  anchorY,
  containerRef,
  state,
  onExitComplete,
  className,
  onAnimationEnd,
  style,
  ...props
}: React.ComponentProps<'div'> & {
  anchorY: number
  containerRef: React.RefObject<HTMLElement | null>
  state: 'open' | 'closed'
  onExitComplete: () => void
}) {
  const placeWing = React.useCallback(
    (wing: HTMLDivElement | null) => {
      const container = containerRef.current
      if (!wing || !container) {
        return
      }

      const half = wing.offsetHeight / 2
      const top = Math.min(Math.max(anchorY, half), container.offsetHeight - half)
      wing.style.top = `${top}px`
    },
    [anchorY, containerRef],
  )

  return (
    <div
      {...props}
      className={cn(
        'ark-control-wing! ark-morph-wing absolute left-full z-20 -ml-px flex max-h-64 -translate-y-1/2 flex-col overflow-hidden rounded-r-lg bg-clip-padding',
        className,
      )}
      data-state={state}
      onAnimationEnd={(event) => {
        onAnimationEnd?.(event)
        if (state === 'closed' && event.target === event.currentTarget) {
          onExitComplete()
        }
      }}
      ref={placeWing}
      style={{ ...style, top: anchorY }}
    />
  )
}
