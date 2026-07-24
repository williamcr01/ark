import { FileCode2Icon, Loader2Icon, Maximize2Icon, MonitorPlayIcon } from 'lucide-react'

import type { DeckBrowserAnalysis } from '@/lib/deck-analysis'

type DeckPreviewHeaderProps = {
  activeSlideIndex: number
  analysis: DeckBrowserAnalysis
  canPresent: boolean
  isPresentOpen: boolean
  isTextEditSaving: boolean
  onPresent: () => void
  usesSandboxHost: boolean
}

export function DeckPreviewHeader({
  activeSlideIndex,
  analysis,
  canPresent,
  isPresentOpen,
  isTextEditSaving,
  onPresent,
  usesSandboxHost,
}: DeckPreviewHeaderProps) {
  const { runtimeManifest, slideCount, usesStaticPreview } = analysis

  return (
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
          {slideCount > 0 ? `Slide ${activeSlideIndex + 1} of ${slideCount}` : 'HTML deck'}
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ark-titlebar-muted)]">
        <button
          aria-label="Present fullscreen"
          className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-2 text-[11px] font-medium text-[var(--ark-titlebar-fg)] transition-colors hover:bg-[var(--ark-titlebar-hover)] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canPresent || isPresentOpen}
          onClick={onPresent}
          type="button"
        >
          <Maximize2Icon className="size-3" />
          Present
        </button>
        {isTextEditSaving && !isPresentOpen ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ark-titlebar-muted)]">
            <Loader2Icon className="size-3 animate-spin" />
            Saving edit
          </span>
        ) : null}
        {!isPresentOpen && analysis.allowsDeckInitScripts ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
            Scripts running
          </span>
        ) : !isPresentOpen && runtimeManifest.runtimeMode === 'reveal' && !usesStaticPreview ? (
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-300">
            Reveal runtime
          </span>
        ) : !isPresentOpen && usesStaticPreview ? (
          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">
            Static preview
          </span>
        ) : null}
        {!isPresentOpen ? (
          <span className="flex items-center gap-1">
            <FileCode2Icon className="size-3" />
            {usesSandboxHost ? 'Sandbox host' : 'srcDoc'}
          </span>
        ) : null}
      </span>
    </div>
  )
}
