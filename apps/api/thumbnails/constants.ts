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
export const THUMBNAIL_SETTLE_MS = 120
export const THUMBNAIL_MAX_PNG_BYTES = 1_500_000
export const THUMBNAIL_CACHE_MAX_ENTRIES = 200
export const THUMBNAIL_MAX_RENDER_ATTEMPTS = 3
export const THUMBNAIL_FAILED_RETRY_DELAY_MS = 30_000
export const THUMBNAIL_QUEUE_MAX_PENDING = 20

export const THUMBNAIL_STATUS = {
  ready: 'ready',
  pending: 'pending',
  failed: 'failed',
  disabled: 'disabled',
} as const

export type ThumbnailStatus = (typeof THUMBNAIL_STATUS)[keyof typeof THUMBNAIL_STATUS]
