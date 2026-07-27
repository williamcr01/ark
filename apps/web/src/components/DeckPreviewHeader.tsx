import { FileCode2Icon, Maximize2Icon, MonitorPlayIcon } from 'lucide-react'

import type { DeckBrowserAnalysis } from '@/lib/deck-analysis'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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
    <div className="flex h-9 shrink-0 items-center justify-between border-b bg-[var(--ark-panel-raised)] px-3">
      <div className="flex min-w-0 items-center gap-2">
        <MonitorPlayIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-heading text-xs font-semibold">Preview</span>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {slideCount > 0 ? `Slide ${activeSlideIndex + 1} of ${slideCount}` : 'HTML deck'}
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        {isTextEditSaving && !isPresentOpen ? <Badge variant="secondary">Saving edit</Badge> : null}
        {!isPresentOpen && analysis.allowsDeckInitScripts ? (
          <Badge variant="outline">Scripts running</Badge>
        ) : !isPresentOpen && runtimeManifest.runtimeMode === 'reveal' && !usesStaticPreview ? (
          <Badge variant="outline">Reveal runtime</Badge>
        ) : !isPresentOpen && usesStaticPreview ? (
          <Badge variant="secondary">Static preview</Badge>
        ) : null}
        {!isPresentOpen ? (
          <Badge variant="ghost">
            <FileCode2Icon />
            {usesSandboxHost ? 'Sandbox' : 'srcDoc'}
          </Badge>
        ) : null}
        <Button
          aria-label="Present fullscreen"
          disabled={!canPresent || isPresentOpen}
          onClick={onPresent}
          size="xs"
          type="button"
          variant="outline"
        >
          <Maximize2Icon />
          Present
        </Button>
      </span>
    </div>
  )
}
