import { Skeleton } from '@/components/ui/skeleton'
import { PREVIEW_FRAME_ASPECT_RATIO } from '@/lib/deck/deck-preview'
import { INITIAL_EAGER_THUMBNAILS, type ThumbnailOrientation } from '@/lib/deck/thumbnail-strip'
import { cn } from '@/lib/ui/utils'

export function ThumbnailStripSkeletons({ orientation }: { orientation: ThumbnailOrientation }) {
  return (
    <>
      {Array.from({ length: INITIAL_EAGER_THUMBNAILS }, (_, index) => (
        <div className="relative rounded-sm" key={index}>
          <Skeleton
            className={cn(
              'block shrink-0 rounded-sm motion-reduce:animate-none',
              orientation === 'vertical' ? 'w-full' : 'w-[152px]',
            )}
            style={{ aspectRatio: PREVIEW_FRAME_ASPECT_RATIO }}
          />
        </div>
      ))}
    </>
  )
}
