export type ThumbnailRenderRequest = {
  html: string
  deckId?: string
  documentRevision?: number
  slideIndexes?: number[]
  slideCount?: number
  signal?: AbortSignal
}

export type ThumbnailRenderSuccess = {
  ok: true
  slides: Buffer[]
  slideCount: number
  width: number
  height: number
  durationMs: number
}

export type ThumbnailRenderFailure = {
  ok: false
  error: string
  durationMs: number
  aborted?: boolean
}

export type ThumbnailRenderResult = ThumbnailRenderSuccess | ThumbnailRenderFailure

export type ThumbnailRenderer = {
  isAvailable: () => boolean
  render: (request: ThumbnailRenderRequest) => Promise<ThumbnailRenderResult>
  close: () => Promise<void>
}

export const THUMBNAIL_RENDER_ABORTED_ERROR = 'Thumbnail render aborted.'

export function createDisabledThumbnailRenderer(): ThumbnailRenderer {
  return {
    isAvailable: () => false,
    close: async () => undefined,
    render: async () => ({
      ok: false,
      error: 'Thumbnail renderer is only available inside the Ark desktop app.',
      durationMs: 0,
    }),
  }
}
