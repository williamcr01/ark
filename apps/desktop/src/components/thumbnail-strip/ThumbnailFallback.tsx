import {
  getThumbnailSandbox,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
} from '@/lib/deck/deck-preview'

export function ThumbnailFallback({
  imageReady,
  index,
  srcDoc,
  thumbnailUrl,
}: {
  imageReady: boolean
  index: number
  srcDoc: string | null
  thumbnailUrl: string | null
}) {
  if (imageReady || !srcDoc) {
    return null
  }

  return (
    <iframe
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-0 block rounded-sm border-0 bg-white"
      sandbox={getThumbnailSandbox()}
      srcDoc={srcDoc}
      style={{
        width: PREVIEW_FRAME_WIDTH,
        height: PREVIEW_FRAME_HEIGHT,
        transform: 'scale(var(--ark-thumb-scale))',
        transformOrigin: 'top left',
      }}
      tabIndex={-1}
      title={thumbnailUrl ? `Loading slide ${index + 1}` : `Slide ${index + 1} thumbnail`}
    />
  )
}
