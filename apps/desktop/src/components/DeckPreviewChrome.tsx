import { type ChangeEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { EditModeToolbar, type EditModeToolbarActions } from '@/components/EditModeToolbar'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeckStore } from '@/state/deck-store.ts'
import type { ImageFitMode } from '@ark/deck/document/image.ts'

export type DeckPreviewChromeProps = {
  actions: EditModeToolbarActions
  chromeHost?: HTMLElement | null
  editChromeActive: boolean
  editorBridgeEnabled: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  imageAlt: string
  imageFit: ImageFitMode
  onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  toolbarState: {
    canEditText: boolean
    hasDeck: boolean
    hasSelection: boolean
    selectedImage: boolean
    selectionLocked: boolean
    selectionManaged: boolean
    selectionUnsafe?: boolean
  }
}

function ToolbarSkeleton() {
  return (
    <div
      aria-hidden
      className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3"
      data-slot="deck-toolbar-skeleton"
    >
      {['select', 'text', 'image'].map((tool) => (
        <Skeleton className="size-7 rounded-sm motion-reduce:animate-none" key={tool} />
      ))}
      <Skeleton className="h-5 w-px rounded-none motion-reduce:animate-none" />
      <Skeleton className="size-7 rounded-sm motion-reduce:animate-none" />
    </div>
  )
}

export function DeckPreviewChrome({
  actions,
  chromeHost = null,
  editChromeActive,
  editorBridgeEnabled,
  fileInputRef,
  imageAlt,
  imageFit,
  onImageFileChange,
  toolbarState,
}: DeckPreviewChromeProps) {
  const isDeckLoading = useDeckStore((state) => state.isLoading)

  let previewChrome: ReactNode = null
  if (editorBridgeEnabled && isDeckLoading) {
    previewChrome = <ToolbarSkeleton />
  } else if (editorBridgeEnabled && editChromeActive) {
    previewChrome = (
      <EditModeToolbar
        actions={actions}
        imageAlt={imageAlt}
        imageFit={imageFit}
        state={toolbarState}
      />
    )
  }

  return (
    <>
      {chromeHost ? createPortal(previewChrome, chromeHost) : previewChrome}
      <input
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={onImageFileChange}
        ref={fileInputRef}
        type="file"
      />
    </>
  )
}
