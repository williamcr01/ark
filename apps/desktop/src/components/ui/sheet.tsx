import { Dialog as SheetPrimitive } from 'radix-ui'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { XIcon } from 'lucide-react'

const Sheet = SheetPrimitive.Root
const SheetClose = SheetPrimitive.Close
const SheetTrigger = SheetPrimitive.Trigger

function SheetContent({
  className,
  children,
  forceMount,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <SheetPrimitive.Portal forceMount={forceMount}>
      <SheetPrimitive.Overlay className="fixed inset-x-0 top-11 bottom-0 z-50 bg-[var(--ark-overlay)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        className={cn(
          'fixed top-11 right-0 bottom-0 z-50 flex h-auto w-full flex-col border-l bg-popover text-popover-foreground shadow-xl transition-transform duration-200 data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 sm:w-[440px]',
          className,
        )}
        data-slot="sheet-content"
        forceMount={forceMount}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close asChild>
            <Button
              aria-label="Close"
              className="absolute top-2 right-2"
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn('font-heading text-base font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger }
