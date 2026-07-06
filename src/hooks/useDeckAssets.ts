import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ALLOWED_ASSET_MEDIA_TYPES,
  MAX_ASSET_UPLOAD_BYTES,
  isAllowedAssetMediaType,
} from '../../shared/assets.ts'
import {
  deleteAsset as deleteAssetRequest,
  listDeckAssets,
  readFileAsDataUrl,
  uploadDeckAsset,
  type AssetMetadataResponse,
} from '@/lib/asset-api'

export type { AssetMetadataResponse }

export type AssetUploadState = {
  id: string
  filename: string
  byteSize: number
  mediaType: string
  status: 'uploading' | 'error'
  error?: string
}

let uploadCounter = 0
const nextUploadId = () => `upload-${Date.now()}-${(uploadCounter += 1)}`

function validateFile(file: File): string | null {
  if (!isAllowedAssetMediaType(file.type)) {
    return `${file.name}: unsupported type (${file.type || 'unknown'}). Allowed: ${Object.keys(
      ALLOWED_ASSET_MEDIA_TYPES,
    ).join(', ')}.`
  }

  if (file.size > MAX_ASSET_UPLOAD_BYTES) {
    return `${file.name}: exceeds the ${Math.round(MAX_ASSET_UPLOAD_BYTES / (1024 * 1024))} MB limit.`
  }

  return null
}

export function useDeckAssets(deckId: string | null) {
  const [assets, setAssets] = useState<AssetMetadataResponse[]>([])
  const [uploads, setUploads] = useState<AssetUploadState[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const deckIdRef = useRef(deckId)

  deckIdRef.current = deckId

  const reload = useCallback(async () => {
    if (!deckId) {
      setAssets([])
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const loaded = await listDeckAssets(deckId)
      if (deckIdRef.current === deckId) {
        setAssets(loaded)
      }
    } catch (loadError) {
      if (deckIdRef.current === deckId) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load deck assets.')
      }
    } finally {
      if (deckIdRef.current === deckId) {
        setIsLoading(false)
      }
    }
  }, [deckId])

  useEffect(() => {
    setUploads([])
    setSelectedAssetIds([])
    void reload()
  }, [reload])

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const targetDeckId = deckIdRef.current

      if (!targetDeckId) {
        setError('Save the deck before uploading assets.')
        return
      }

      for (const file of files) {
        const uploadId = nextUploadId()
        const validationError = validateFile(file)

        if (validationError) {
          setUploads((current) => [
            ...current,
            {
              id: uploadId,
              filename: file.name,
              byteSize: file.size,
              mediaType: file.type,
              status: 'error',
              error: validationError,
            },
          ])
          continue
        }

        setUploads((current) => [
          ...current,
          {
            id: uploadId,
            filename: file.name,
            byteSize: file.size,
            mediaType: file.type,
            status: 'uploading',
          },
        ])

        try {
          const dataUrl = await readFileAsDataUrl(file)
          const asset = await uploadDeckAsset(targetDeckId, {
            filename: file.name,
            mediaType: file.type,
            data: dataUrl,
          })

          if (deckIdRef.current !== targetDeckId) {
            return
          }

          setUploads((current) => current.filter((upload) => upload.id !== uploadId))
          setAssets((current) => [asset, ...current.filter((existing) => existing.id !== asset.id)])
          setSelectedAssetIds((current) =>
            current.includes(asset.id) ? current : [...current, asset.id],
          )
        } catch (uploadError) {
          if (deckIdRef.current !== targetDeckId) {
            return
          }

          const message =
            uploadError instanceof Error ? uploadError.message : 'Could not upload the file.'
          setUploads((current) =>
            current.map((upload) =>
              upload.id === uploadId ? { ...upload, status: 'error', error: message } : upload,
            ),
          )
        }
      }
    },
    [],
  )

  const removeAsset = useCallback(async (assetId: string) => {
    try {
      await deleteAssetRequest(assetId)
      setAssets((current) => current.filter((asset) => asset.id !== assetId))
      setSelectedAssetIds((current) => current.filter((id) => id !== assetId))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the asset.')
    }
  }, [])

  const dismissUpload = useCallback((uploadId: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== uploadId))
  }, [])

  const toggleAssetSelected = useCallback((assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    )
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedAssetIds([])
  }, [])

  return {
    assets,
    uploads,
    selectedAssetIds,
    isLoading,
    error,
    reload,
    uploadFiles,
    removeAsset,
    dismissUpload,
    toggleAssetSelected,
    clearSelection,
    setError,
  }
}
