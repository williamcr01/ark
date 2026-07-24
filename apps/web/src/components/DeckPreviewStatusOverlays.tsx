import { Loader2Icon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type DeckPreviewStatusOverlaysProps = {
  compromised: boolean
  editorError: string | null
  frameError: string | null
  isLoading: boolean
  isPreviewUpdating: boolean
  isPresentOpen: boolean
  networkIssue?: string
  usesStaticPreview: boolean
}

export function DeckPreviewStatusOverlays({
  compromised,
  editorError,
  frameError,
  isLoading,
  isPreviewUpdating,
  isPresentOpen,
  networkIssue,
  usesStaticPreview,
}: DeckPreviewStatusOverlaysProps) {
  if (isPresentOpen) {
    return null
  }

  return (
    <>
      {compromised ? (
        <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100">
          <div className="flex items-start gap-2">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Preview stopped</p>
              <p>
                The deck attempted an unexpected navigation. Preview was torn down to stop further
                bridge messages from reaching an untrusted page. Edit or reload the deck to restore
                the preview.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {frameError ? (
        <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100">
          <p className="font-medium">Sandbox preview unavailable</p>
          <p>{frameError}</p>
        </div>
      ) : null}
      {isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-muted-foreground backdrop-blur-sm">
          Loading sandbox preview…
        </div>
      ) : null}
      {usesStaticPreview ? (
        <div className="absolute inset-x-4 top-4 rounded-lg border border-sky-500/30 bg-sky-50/95 px-3 py-2 text-xs text-sky-950 shadow-sm backdrop-blur dark:bg-sky-950/90 dark:text-sky-100">
          <div className="flex items-start gap-2">
            <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Static preview</p>
              <p>
                Scripts and inline handlers were removed for preview. Download the original HTML to
                keep executable code, or choose sanitized export to match this preview.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {editorError ? (
        <div
          className={cn(
            'absolute inset-x-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100',
            usesStaticPreview ? 'top-24' : 'top-4',
          )}
        >
          <p className="font-medium">Editor bridge error</p>
          <p>{editorError}</p>
        </div>
      ) : null}
      {networkIssue ? (
        <div
          className={cn(
            'absolute inset-x-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100',
            usesStaticPreview ? 'top-24' : 'top-4',
          )}
        >
          <div className="flex items-start gap-2">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Network access blocked</p>
              <p>{networkIssue}</p>
            </div>
          </div>
        </div>
      ) : null}
      {isPreviewUpdating ? (
        <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
          <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
          Updating preview
        </div>
      ) : null}
    </>
  )
}
