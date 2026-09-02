import { useEffect, useMemo, useRef, useState } from 'react'

import {
  getPreviewHtml,
  getThumbnailSandbox,
  PREVIEW_FRAME_ASPECT_RATIO,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
  PREVIEW_IFRAME_SECURITY_PROPS,
} from '@/lib/deck/deck-preview'
import { cn } from '@/lib/ui/utils'

type MiniHtmlPreviewProps = {
  html: string
  title: string
  className?: string
  /** Show only this slide in a multi-slide sample (0-based). */
  slideIndex?: number
}

export function MiniHtmlPreview({ html, title, className, slideIndex }: MiniHtmlPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const srcDoc = useMemo(
    () => getPreviewHtml(html, { initialSlideIndex: slideIndex }),
    [html, slideIndex],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const update = () => {
      setScale(element.clientWidth / PREVIEW_FRAME_WIDTH)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={cn('relative w-full overflow-hidden bg-white', className)}
      ref={containerRef}
      style={{ aspectRatio: PREVIEW_FRAME_ASPECT_RATIO }}
    >
      {scale > 0 ? (
        <iframe
          className="pointer-events-none absolute left-0 top-0 block border-0 bg-white"
          sandbox={getThumbnailSandbox()}
          srcDoc={srcDoc}
          style={{
            width: PREVIEW_FRAME_WIDTH,
            height: PREVIEW_FRAME_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          tabIndex={-1}
          title={title}
          {...PREVIEW_IFRAME_SECURITY_PROPS}
        />
      ) : null}
    </div>
  )
}
