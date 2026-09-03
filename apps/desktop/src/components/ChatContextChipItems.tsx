import { BoxSelectIcon, PresentationIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
} from '@/components/ai-elements/attachments'

export type ContextChipElement = {
  slideIndex: number
  kind?: string
  textPreview?: string | null
}

export type ContextChipSlide = {
  slideIndex: number
  title?: string
}

function formatSlideChipLabel(slide: ContextChipSlide): string {
  return `Slide ${slide.slideIndex + 1}${slide.title ? ` — ${slide.title}` : ''}`
}

export function ContextElementChip({
  elementCount,
  onClearElement,
}: {
  elementCount: number
  onClearElement?: () => void
}) {
  const elementLabel = elementCount === 1 ? 'element' : 'elements'
  return (
    <Attachment
      data={{
        type: 'source-document',
        id: 'context-elements',
        sourceId: 'context-elements',
        title: `${elementCount} ${elementLabel}`,
        mediaType: 'text/plain',
      }}
      onRemove={onClearElement}
    >
      <AttachmentPreview
        fallbackIcon={<BoxSelectIcon className="size-3 text-muted-foreground" />}
      />
      <AttachmentInfo />
      {onClearElement ? (
        <AttachmentRemove label={`Remove selected ${elementLabel} from chat context`} />
      ) : null}
    </Attachment>
  )
}

export function ContextSlideChips({
  slides,
  onRemoveSlide,
  onClearSlides,
}: {
  slides: ContextChipSlide[]
  onRemoveSlide?: (slideIndex: number) => void
  onClearSlides?: () => void
}) {
  const clearAllSlides = () => {
    if (onClearSlides) {
      onClearSlides()
      return
    }
    slides.forEach((slide) => onRemoveSlide?.(slide.slideIndex))
  }

  if (slides.length > 1) {
    return (
      <Attachment
        data={{
          type: 'source-document',
          id: 'context-slides',
          sourceId: 'context-slides',
          title: `${slides.length} slides`,
          mediaType: 'text/html',
        }}
        onRemove={onRemoveSlide || onClearSlides ? clearAllSlides : undefined}
      >
        <AttachmentPreview
          fallbackIcon={<PresentationIcon className="size-3 text-muted-foreground" />}
        />
        <AttachmentInfo />
        {onRemoveSlide || onClearSlides ? (
          <AttachmentRemove label="Remove attached slides from chat context" />
        ) : null}
      </Attachment>
    )
  }

  return (
    <>
      {slides.map((slide) => (
        <Attachment
          data={{
            type: 'source-document',
            id: `context-slide-${slide.slideIndex}`,
            sourceId: `context-slide-${slide.slideIndex}`,
            title: formatSlideChipLabel(slide),
            mediaType: 'text/html',
          }}
          key={slide.slideIndex}
          onRemove={onRemoveSlide ? () => onRemoveSlide(slide.slideIndex) : undefined}
        >
          <AttachmentPreview
            fallbackIcon={<PresentationIcon className="size-3 text-muted-foreground" />}
          />
          <AttachmentInfo />
          {onRemoveSlide ? (
            <AttachmentRemove label={`Remove slide ${slide.slideIndex + 1} from chat context`} />
          ) : null}
        </Attachment>
      ))}
    </>
  )
}
