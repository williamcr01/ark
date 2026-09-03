import type { RefObject } from 'react'

import { DeckPreviewStrip } from '@/components/DeckPreviewStrip'
import type { DeckEditorLayerModel } from '@/hooks/useDeckEditorLayer'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import { cn } from '@/lib/ui/utils'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'

import {
  DeckPreviewChromeBind,
  DeckPreviewPresentBind,
  DeckPreviewStageBind,
} from './DeckPreviewBinds.tsx'

type DeckPreviewSessionModel = ReturnType<
  typeof import('@/hooks/useDeckPreviewSession').useDeckPreviewSession
>

export function DeckPreviewView({
  analysis,
  chromeHost,
  editorBridgeEnabled,
  handleReorderSlide,
  hasDeck,
  imageInputRef,
  layer,
  layout,
  onRestoreHistory,
  onToggleContextSlide,
  session,
}: {
  analysis: DeckBrowserAnalysis
  chromeHost?: HTMLElement | null
  editorBridgeEnabled: boolean
  handleReorderSlide: (
    fromIndex: number,
    toIndex: number,
  ) => Promise<DeckPreviewPatchResult | undefined>
  hasDeck: boolean
  imageInputRef: RefObject<HTMLInputElement | null>
  layer: DeckEditorLayerModel
  layout: 'desktop' | 'mobile'
  onRestoreHistory?: (revision: number) => Promise<void>
  onToggleContextSlide?: (index: number) => void
  session: DeckPreviewSessionModel
}) {
  const mainPreviewReady =
    session.chrome.previewCompromised ||
    Boolean(session.frame.previewFrame.error) ||
    (session.session.armed &&
      !session.frame.previewFrame.isLoading &&
      !session.frame.previewFrame.isStale)

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--ark-stage)]">
      <DeckPreviewChromeBind
        chromeHost={chromeHost}
        editorBridgeEnabled={editorBridgeEnabled}
        hasDeck={hasDeck}
        imageInputRef={imageInputRef}
        layer={layer}
        onRestoreHistory={onRestoreHistory}
        session={session}
      />
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          layout === 'desktop' ? 'flex flex-row' : 'flex flex-col',
        )}
      >
        <DeckPreviewStrip
          analysis={analysis}
          contentEnabled={mainPreviewReady}
          editChromeActive={session.chrome.editChromeActive}
          layout={layout}
          livePatchPending={session.source.livePatchPending}
          navigation={{
            activeIndex: session.navigation.activeSlideIndex,
            onSelect: session.navigation.goToSlide,
          }}
          onReorder={handleReorderSlide}
          onToggleContextSlide={onToggleContextSlide}
        />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <DeckPreviewStageBind
            analysis={analysis}
            editorBridgeEnabled={editorBridgeEnabled}
            layer={layer}
            session={session}
          />
        </div>
      </div>
      <DeckPreviewPresentBind analysis={analysis} session={session} />
    </section>
  )
}
