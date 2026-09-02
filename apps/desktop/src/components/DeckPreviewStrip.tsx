import { useDeferredValue } from 'react'

import { SlideThumbnailStrip } from '@/components/SlideThumbnailStrip'
import { useAlignedThumbnailUrls } from '@/hooks/useAlignedThumbnailUrls'
import { useDeckThumbnails } from '@/hooks/useDeckThumbnails'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'

type DeckPreviewStripProps = {
  analysis: DeckBrowserAnalysis
  contentEnabled: boolean
  editChromeActive: boolean
  layout: 'desktop' | 'mobile'
  livePatchPending: boolean
  navigation: {
    activeIndex: number
    onSelect: (index: number) => void
  }
  onReorder: (fromIndex: number, toIndex: number) => Promise<DeckPreviewPatchResult | undefined>
  onToggleContextSlide?: (index: number) => void
}

export function DeckPreviewStrip({
  analysis,
  contentEnabled,
  editChromeActive,
  layout,
  livePatchPending,
  navigation,
  onReorder,
  onToggleContextSlide,
}: DeckPreviewStripProps) {
  const deckId = useDeckStore((state) => state.deckId)
  const documentRevision = useDeckStore((state) => state.documentRevision)
  const isDeckLoading = useDeckStore((state) => state.isLoading)
  const isTextEditSaving = useDeckStore((state) => state.isPatching || state.isSaving)
  const isPreviewUpdating = useChatStore((state) => state.isPreviewUpdating)
  const isStripOpen = useEditorStore((state) => state.isStripOpen)
  const contextSlides = useEditorStore((state) => state.contextSlides)
  const { thumbnailUrls } = useDeckThumbnails(deckId, documentRevision, analysis.slideCount, {
    enabled: contentEnabled && !livePatchPending,
  })
  const deferredParsedDeck = useDeferredValue(analysis)
  const stripParsedDeck =
    deferredParsedDeck.slideCount === 0 && analysis.slideCount > 0 ? analysis : deferredParsedDeck
  const deferredThumbnailUrls = useAlignedThumbnailUrls(
    stripParsedDeck,
    useDeferredValue(thumbnailUrls),
  )
  const hasSlides = analysis.slideCount > 0
  if (!isDeckLoading && !hasSlides) {
    return null
  }

  return (
    <SlideThumbnailStrip
      activeIndex={navigation.activeIndex}
      contentEnabled={contentEnabled}
      contextSlideIndexes={contextSlides.map((entry) => entry.slideIndex)}
      id="ark-slide-strip"
      isOpen={isStripOpen}
      isLoading={isDeckLoading}
      onReorder={
        editChromeActive && !isPreviewUpdating && !isTextEditSaving ? onReorder : undefined
      }
      onSelect={navigation.onSelect}
      onToggleContextSlide={onToggleContextSlide}
      orientation={layout === 'desktop' ? 'vertical' : 'horizontal'}
      parsedDeck={stripParsedDeck}
      thumbnailUrls={deferredThumbnailUrls}
    />
  )
}
