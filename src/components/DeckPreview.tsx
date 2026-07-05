import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileCode2Icon,
  Loader2Icon,
  Maximize2Icon,
  MonitorPlayIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  WandSparklesIcon,
} from 'lucide-react'

import { PresentMode } from '@/components/PresentMode'
import { SlideThumbnailStrip } from '@/components/SlideThumbnailStrip'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import { useElementSize } from '@/hooks/useElementSize'
import {
  detectRuntimeMode,
  getPreviewFrameScale,
  getPreviewFrameStyle,
  getPreviewSandbox,
  getPreviewStageStyle,
} from '@/lib/deck-preview'
import { parseDeckSlides } from '@/lib/deck-slides'
import { previewStripsDeckScripts } from '@/lib/deck-export'
import { validateDeckHtmlInBrowser } from '@/lib/deck-validate'
import { cn } from '@/lib/utils'

export type DeckPreviewProps = {
  html: string
  isGenerating: boolean
  isStripOpen: boolean
  layout: 'desktop' | 'mobile'
  parsedDeck: ReturnType<typeof parseDeckSlides>
}

export function DeckPreview({
  html,
  isGenerating,
  isStripOpen,
  layout,
  parsedDeck,
}: DeckPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewViewportRef, previewViewportSize] = useElementSize<HTMLDivElement>()
  const [isPresentOpen, setIsPresentOpen] = useState(false)
  const pendingPresentExitIndexRef = useRef<number | null>(null)
  const runtimeMode = useMemo(() => detectRuntimeMode(html), [html])
  const validation = useMemo(() => validateDeckHtmlInBrowser(html), [html])
  const usesStaticPreview = useMemo(() => previewStripsDeckScripts(html), [html])
  const networkIssues = validation.issues.filter(
    (issue) => issue.code === 'external_url' && issue.severity === 'error',
  )
  const hasSlides = parsedDeck.slideCount > 0
  const previewFrame = useDeckPreviewFrame(html, html.length > 0 && hasSlides && !isPresentOpen)
  const { activeSlideIndex, goToSlide } = useDeckSlideNavigation(
    iframeRef,
    parsedDeck.slideCount,
    html,
    html.length > 0 && hasSlides && !isPresentOpen,
    {
      runtimeMode,
      keyboardMode: isPresentOpen ? 'off' : 'preview',
      sandboxOrigin: previewFrame.sandboxOrigin,
    },
  )

  useEffect(() => {
    if (isPresentOpen || pendingPresentExitIndexRef.current === null) {
      return
    }

    const finalIndex = pendingPresentExitIndexRef.current
    pendingPresentExitIndexRef.current = null
    goToSlide(finalIndex)
  }, [goToSlide, isPresentOpen])

  const previewFrameScale = getPreviewFrameScale(previewViewportSize)
  const previewStageStyle = getPreviewStageStyle(previewFrameScale)
  const previewFrameStyle = getPreviewFrameStyle(previewFrameScale)
  const hasStrip = hasSlides
  const stripOrientation = layout === 'desktop' ? 'vertical' : 'horizontal'
  const canPresent = html.length > 0 && hasSlides && !isGenerating

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--ark-preview)]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--ark-titlebar-fg)]">
          <MonitorPlayIcon
            aria-hidden
            className="size-3.5 shrink-0 text-[var(--ark-titlebar-muted)]"
          />
          <span className="truncate text-xs font-medium">Preview</span>
          <span aria-hidden className="text-[var(--ark-titlebar-muted)]">
            ›
          </span>
          <span className="truncate text-xs text-[var(--ark-titlebar-muted)]">
            {parsedDeck.slideCount > 0
              ? `Slide ${activeSlideIndex + 1} of ${parsedDeck.slideCount}`
              : 'HTML deck'}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ark-titlebar-muted)]">
          <button
            aria-label="Present fullscreen"
            className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-2 text-[11px] font-medium text-[var(--ark-titlebar-fg)] transition-colors hover:bg-[var(--ark-titlebar-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canPresent || isPresentOpen}
            onClick={() => setIsPresentOpen(true)}
            type="button"
          >
            <Maximize2Icon className="size-3" />
            Present
          </button>
          {runtimeMode === 'custom-js' ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
              Scripts running
            </span>
          ) : runtimeMode === 'reveal' && !usesStaticPreview ? (
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-300">
              Reveal runtime
            </span>
          ) : usesStaticPreview ? (
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">
              Static preview
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <FileCode2Icon className="size-3" />
            {previewFrame.usesSandboxHost ? 'Sandbox host' : 'srcDoc'}
          </span>
        </span>
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          layout === 'desktop' ? 'flex flex-row' : 'flex flex-col',
        )}
      >
        {hasStrip ? (
          <SlideThumbnailStrip
            activeIndex={activeSlideIndex}
            id="ark-slide-strip"
            isOpen={isStripOpen}
            key={html}
            onSelect={goToSlide}
            orientation={stripOrientation}
            parsedDeck={parsedDeck}
          />
        ) : null}

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
            ref={previewViewportRef}
          >
            {html ? (
              <div
                className="relative max-h-full max-w-full overflow-hidden bg-white shadow-2xl shadow-slate-950/10 ring-1 ring-[var(--ark-stage-border)]"
                style={previewStageStyle}
              >
                <iframe
                  className="absolute left-0 top-0 block border-0 bg-white"
                  key={previewFrame.iframeKey}
                  ref={iframeRef}
                  referrerPolicy="no-referrer"
                  sandbox={getPreviewSandbox(runtimeMode)}
                  src={previewFrame.iframeSrc}
                  srcDoc={previewFrame.iframeSrcDoc}
                  style={previewFrameStyle}
                  title="Generated Ark presentation preview"
                />
                {previewFrame.error ? (
                  <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100">
                    <p className="font-medium">Sandbox preview unavailable</p>
                    <p>{previewFrame.error}</p>
                  </div>
                ) : null}
                {previewFrame.isLoading ? (
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
                          Scripts and inline handlers were removed for preview. Download the
                          original HTML to keep executable code, or choose sanitized export to match
                          this preview.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {networkIssues.length > 0 ? (
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
                        <p>{networkIssues[0]?.message}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {isGenerating ? (
                  <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    Updating preview
                  </div>
                ) : null}
              </div>
            ) : isGenerating ? (
              <PreviewSkeleton scale={previewFrameScale} />
            ) : (
              <EmptyPreview />
            )}
          </div>
        </div>
      </div>

      {isPresentOpen ? (
        <PresentMode
          html={html}
          initialSlideIndex={activeSlideIndex}
          onExit={(finalIndex) => {
            pendingPresentExitIndexRef.current = finalIndex
            setIsPresentOpen(false)
          }}
          runtimeMode={runtimeMode}
          slideCount={parsedDeck.slideCount}
        />
      ) : null}
    </section>
  )
}

function EmptyPreview() {
  return (
    <Card className="w-full max-w-xl border-dashed bg-white/80 text-center shadow-none">
      <CardHeader className="items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--ark-accent-soft)] text-[var(--ark-accent)]">
          <WandSparklesIcon className="size-6" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle>Ready for your first deck</CardTitle>
          <CardDescription>
            Ask Ark for a pitch deck, strategy update, sales proposal, research summary, or any
            presentation you need.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border bg-[var(--ark-paper)] p-4 text-left text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Try:</p>
          <p>“Create a 6-slide launch deck for a privacy-first notes app.”</p>
        </div>
      </CardContent>
    </Card>
  )
}

function PreviewSkeleton({ scale }: { scale: number }) {
  return (
    <div
      className="max-h-full max-w-full bg-white p-8 shadow-2xl shadow-slate-950/10 ring-1 ring-[var(--ark-stage-border)]"
      style={getPreviewStageStyle(scale)}
    >
      <div className="flex h-full flex-col gap-8">
        <div className="flex items-center justify-between gap-8">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="grid flex-1 grid-cols-[1.2fr_0.8fr] gap-8">
          <div className="flex flex-col justify-center gap-4">
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-10 w-3/5" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
