export const THUMBNAIL_VIEWPORT_WIDTH = 1600
export const THUMBNAIL_VIEWPORT_HEIGHT = 900
export const THUMBNAIL_OUTPUT_WIDTH = 480
export const THUMBNAIL_OUTPUT_HEIGHT = Math.round(
  (THUMBNAIL_OUTPUT_WIDTH * THUMBNAIL_VIEWPORT_HEIGHT) / THUMBNAIL_VIEWPORT_WIDTH,
)

export const THUMBNAIL_MAX_SLIDES = 40
export const THUMBNAIL_DECK_TIMEOUT_MS = 45_000
export const THUMBNAIL_SLIDE_TIMEOUT_MS = 3_000
export const THUMBNAIL_READY_TIMEOUT_MS = 12_000
/**
 * Max host-side wait for adaptive slide settle. Fixtures stayed byte-identical
 * at 0/40/80/120ms; 40ms keeps a small budget around fonts/images/rAF.
 */
export const THUMBNAIL_SETTLE_MS = 40
export const THUMBNAIL_MAX_PNG_BYTES = 1_500_000
export const THUMBNAIL_CACHE_MAX_ENTRIES = 200
/** Bumped when capture/settle pipeline changes invalidate cached PNGs. */
export const THUMBNAIL_RENDERER_VERSION = 'thumbnail-renderer-v7'
export const THUMBNAIL_MAX_RENDER_ATTEMPTS = 3
export const THUMBNAIL_FAILED_RETRY_DELAY_MS = 30_000
/** Must exceed deck timeout so a live render is not stolen by another process. */
export const THUMBNAIL_PENDING_LEASE_MS = THUMBNAIL_DECK_TIMEOUT_MS + 30_000
/**
 * Deferred cleanup must not delete in-flight blob temp files. Only sweep temps
 * older than this grace window (covers concurrent writes after markReady).
 */
export const THUMBNAIL_TEMP_BLOB_GRACE_MS = 60_000
export const THUMBNAIL_QUEUE_MAX_PENDING = 20
export const THUMBNAIL_QUEUE_CONCURRENCY = 1

export const THUMBNAIL_STATUS = {
  ready: 'ready',
  pending: 'pending',
  failed: 'failed',
  disabled: 'disabled',
} as const

export type ThumbnailStatus = (typeof THUMBNAIL_STATUS)[keyof typeof THUMBNAIL_STATUS]
