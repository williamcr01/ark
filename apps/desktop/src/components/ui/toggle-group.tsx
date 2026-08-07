import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import type * as React from 'react'

import { toggleVariants } from '@/components/ui/toggle-variants'
import { cn } from '@/lib/utils'

function ToggleGroup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('flex w-fit items-center rounded-md border bg-muted/40 p-0.5', className)}
      data-slot="toggle-group"
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(toggleVariants({ size: 'sm' }), className)}
      data-slot="toggle-group-item"
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
