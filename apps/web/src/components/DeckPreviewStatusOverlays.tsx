import { Loader2Icon, ShieldAlertIcon, ShieldCheckIcon, XIcon } from 'lucide-react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DeckPreviewStatusOverlaysProps = {
  compromised: boolean
  editorError: string | null
  frameError: string | null
  isLoading: boolean
  isPreviewUpdating: boolean
  isPresentOpen: boolean
  networkIssue?: string
  onDismissRuntimeError: () => void
  runtimeError: {
    message: string
    slideIndex: number
  } | null
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
  onDismissRuntimeError,
  runtimeError,
  usesStaticPreview,
}: DeckPreviewStatusOverlaysProps) {
  if (isPresentOpen) {
    return null
  }

  return (
    <>
      {compromised ? (
        <Alert
          className="absolute inset-x-4 top-4 z-10 border-destructive/30 text-xs shadow-sm"
          variant="destructive"
        >
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
        </Alert>
      ) : null}
      {frameError ? (
        <Alert
          className="absolute inset-x-4 top-4 border-destructive/30 text-xs shadow-sm"
          variant="destructive"
        >
          <p className="font-medium">Sandbox preview unavailable</p>
          <p>{frameError}</p>
        </Alert>
      ) : null}
      {isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-card/90 text-xs font-medium text-muted-foreground">
          Loading sandbox preview…
        </div>
      ) : null}
      {usesStaticPreview ? (
        <Alert className="absolute inset-x-4 top-4 text-xs shadow-sm">
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
        </Alert>
      ) : null}
      {editorError ? (
        <Alert
          className={cn(
            'absolute inset-x-4 border-destructive/30 text-xs shadow-sm',
            usesStaticPreview ? 'top-24' : 'top-4',
          )}
          variant="destructive"
        >
          <p className="font-medium">Editor bridge error</p>
          <p>{editorError}</p>
        </Alert>
      ) : null}
      {networkIssue ? (
        <Alert
          className={cn(
            'absolute inset-x-4 border-destructive/30 text-xs shadow-sm',
            usesStaticPreview ? 'top-24' : 'top-4',
          )}
          variant="destructive"
        >
          <div className="flex items-start gap-2">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Network access blocked</p>
              <p>{networkIssue}</p>
            </div>
          </div>
        </Alert>
      ) : null}
      {runtimeError ? (
        <Alert
          className="absolute inset-x-4 bottom-4 z-10 border-destructive/30 text-xs shadow-sm"
          variant="destructive"
        >
          <div className="flex items-start gap-2">
            <ShieldAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">Runtime error on slide {runtimeError.slideIndex + 1}</p>
              <p className="break-words text-foreground">{runtimeError.message}</p>
            </div>
            <Button
              aria-label="Dismiss runtime error"
              className="-mr-1 -mt-1 shrink-0"
              onClick={onDismissRuntimeError}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        </Alert>
      ) : null}
      {isPreviewUpdating ? (
        <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
          <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
          Updating preview
        </div>
      ) : null}
    </>
  )
}
