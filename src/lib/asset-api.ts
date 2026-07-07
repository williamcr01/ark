import {
  assetListResponseSchema,
  uploadAssetResponseSchema,
  fetchApiJsonOrThrow,
  type AssetMetadataResponse,
} from '../../shared/api/index.ts'

export type { AssetMetadataResponse }

export type UploadAssetInput = {
  filename: string
  mediaType: string
  /** base64 string or a `data:` URL. */
  data: string
  chatMessageId?: string | null
  source?: 'upload' | 'screenshot' | 'proxy'
}

/** Read a browser File into a base64 `data:` URL for JSON transport. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Could not read the file.'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

export async function uploadDeckAsset(
  deckId: string,
  input: UploadAssetInput,
  signal?: AbortSignal,
): Promise<AssetMetadataResponse> {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })

  const data = await fetchApiJsonOrThrow(response, uploadAssetResponseSchema, {
    fallbackMessage: 'Could not upload the file.',
  })

  return data.asset
}

export async function listDeckAssets(
  deckId: string,
  signal?: AbortSignal,
): Promise<AssetMetadataResponse[]> {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/assets`, { signal })

  const data = await fetchApiJsonOrThrow(response, assetListResponseSchema, {
    fallbackMessage: 'Could not load deck assets.',
  })

  return data.assets
}

export async function deleteAsset(
  deckId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/decks/${encodeURIComponent(deckId)}/assets/${encodeURIComponent(assetId)}`,
    {
      method: 'DELETE',
      signal,
    },
  )

  if (!response.ok && response.status !== 204) {
    const data = await response.json().catch(() => ({}))
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Could not delete the asset.'
    throw new Error(message)
  }
}
