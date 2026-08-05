import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '@/lib/utils'

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  onPointerUp,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // The seam is a border, not a filled 1px box: Chromium snaps border
        // widths to whole device pixels, so this matches every other hairline
        // in the app instead of rounding up to 2px on fractional-DPR screens.
        'relative flex w-0 items-center justify-center border-l border-border outline-none aria-[orientation=horizontal]:h-0 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:border-l-0 aria-[orientation=horizontal]:border-t [&[aria-orientation=horizontal]>div]:rotate-90',
        className,
      )}
      {...props}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        // react-resizable-panels focuses the separator on pointerdown; blur
        // after a drag so arrow keys return to slide navigation.
        event.currentTarget.blur()
      }}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
