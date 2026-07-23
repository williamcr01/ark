import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import {
  ALLOWED_ASSET_MEDIA_TYPES,
  MAX_ASSET_UPLOAD_BYTES,
  isAllowedAssetMediaType,
} from '@ark/deck-core/assets.ts'
import { MAX_CHAT_ATTACHMENTS } from '@ark/deck-core/chat.ts'
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

type AssetSelectionState = {
  ids: string[]
  error: string
}

type AssetSelectionAction =
  | { type: 'add'; assetId: string }
  | { type: 'clear' }
  | { type: 'remove'; assetId: string }
  | { type: 'reset' }
  | { type: 'set-error'; error: string }
  | { type: 'toggle'; assetId: string }

function reduceAssetSelection(
  state: AssetSelectionState,
  action: AssetSelectionAction,
): AssetSelectionState {
  switch (action.type) {
    case 'add':
      return state.ids.includes(action.assetId) || state.ids.length >= MAX_CHAT_ATTACHMENTS
        ? state
        : { ...state, ids: [...state.ids, action.assetId] }
    case 'clear':
    case 'reset':
      return { ...state, ids: [] }
    case 'remove':
      return { ...state, ids: state.ids.filter((id) => id !== action.assetId) }
    case 'set-error':
      return { ...state, error: action.error }
    case 'toggle':
      if (state.ids.includes(action.assetId)) {
        return { ids: state.ids.filter((id) => id !== action.assetId), error: '' }
      }

      if (state.ids.length >= MAX_CHAT_ATTACHMENTS) {
        return {
          ...state,
          error: `You can include up to ${MAX_CHAT_ATTACHMENTS} deck assets per message.`,
        }
      }

      return { ids: [...state.ids, action.assetId], error: '' }
  }
}

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
  const [{ ids: selectedAssetIds, error }, dispatchSelection] = useReducer(reduceAssetSelection, {
    ids: [],
    error: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [trackedDeckId, setTrackedDeckId] = useState(deckId)
  const deckIdRef = useRef(deckId)
  const setError = useCallback(
    (nextError: string) => dispatchSelection({ type: 'set-error', error: nextError }),
    [],
  )

  // Reset transient state synchronously when the active deck changes
  // (React's "adjust state during render" pattern, not an effect).
  if (trackedDeckId !== deckId) {
    setTrackedDeckId(deckId)
    setUploads([])
    dispatchSelection({ type: 'reset' })
  }

  useEffect(() => {
    deckIdRef.current = deckId
  }, [deckId])

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
    const load = async () => {
      await reload()
    }

    void load()
  }, [reload])

  const uploadFiles = useCallback(async (files: File[]) => {
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
        dispatchSelection({ type: 'add', assetId: asset.id })
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
  }, [])

  const removeAsset = useCallback(async (assetId: string) => {
    const targetDeckId = deckIdRef.current

    if (!targetDeckId) {
      setError('Save the deck before removing assets.')
      return
    }

    try {
      await deleteAssetRequest(targetDeckId, assetId)
      setAssets((current) => current.filter((asset) => asset.id !== assetId))
      dispatchSelection({ type: 'remove', assetId })
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the asset.')
    }
  }, [])

  const dismissUpload = useCallback((uploadId: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== uploadId))
  }, [])

  const toggleAssetSelected = useCallback((assetId: string) => {
    dispatchSelection({ type: 'toggle', assetId })
  }, [])

  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' })
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
  }
}
