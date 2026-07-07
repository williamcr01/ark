import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDeckAssets } from './useDeckAssets'
import type { AssetMetadataResponse } from '@/lib/asset-api'

vi.mock('@/lib/asset-api', () => ({
  listDeckAssets: vi.fn(),
  uploadDeckAsset: vi.fn(),
  deleteAsset: vi.fn(),
  readFileAsDataUrl: vi.fn(),
}))

const api = await import('@/lib/asset-api')
const listDeckAssets = vi.mocked(api.listDeckAssets)
const uploadDeckAsset = vi.mocked(api.uploadDeckAsset)
const deleteAsset = vi.mocked(api.deleteAsset)
const readFileAsDataUrl = vi.mocked(api.readFileAsDataUrl)

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

const makeAsset = (overrides: Partial<AssetMetadataResponse> = {}): AssetMetadataResponse => ({
  id: '00000000-0000-4000-8000-000000000701',
  deckId,
  chatMessageId: null,
  filename: 'logo.png',
  mediaType: 'image/png',
  category: 'image',
  byteSize: 128,
  checksum: 'abc',
  source: 'upload',
  storageKind: 'local',
  url: `/api/decks/${deckId}/assets/00000000-0000-4000-8000-000000000701`,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('useDeckAssets', () => {
  beforeEach(() => {
    listDeckAssets.mockResolvedValue([])
    readFileAsDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads deck assets on mount', async () => {
    const existing = makeAsset()
    listDeckAssets.mockResolvedValueOnce([existing])

    const { result } = renderHook(() => useDeckAssets(deckId))

    await waitFor(() => expect(result.current.assets).toHaveLength(1))
    expect(result.current.assets[0]).toEqual(existing)
    expect(result.current.selectedAssetIds).toEqual([])
  })

  it('uploads a valid file, adds it, and auto-selects it', async () => {
    const uploaded = makeAsset()
    uploadDeckAsset.mockResolvedValueOnce(uploaded)

    const { result } = renderHook(() => useDeckAssets(deckId))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const file = new File(['x'], 'logo.png', { type: 'image/png' })

    await act(async () => {
      await result.current.uploadFiles([file])
    })

    await waitFor(() => expect(result.current.assets).toHaveLength(1))
    expect(result.current.selectedAssetIds).toContain(uploaded.id)
    expect(result.current.uploads).toHaveLength(0)
  })

  it('surfaces a client-side validation error without calling the API', async () => {
    const { result } = renderHook(() => useDeckAssets(deckId))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const file = new File(['x'], 'app.exe', { type: 'application/x-msdownload' })

    await act(async () => {
      await result.current.uploadFiles([file])
    })

    expect(uploadDeckAsset).not.toHaveBeenCalled()
    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0].status).toBe('error')
  })

  it('marks an upload as errored when the API rejects it', async () => {
    uploadDeckAsset.mockRejectedValueOnce(new Error('Server said no.'))

    const { result } = renderHook(() => useDeckAssets(deckId))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const file = new File(['x'], 'logo.png', { type: 'image/png' })

    await act(async () => {
      await result.current.uploadFiles([file])
    })

    await waitFor(() => expect(result.current.uploads[0]?.status).toBe('error'))
    expect(result.current.uploads[0].error).toBe('Server said no.')
    expect(result.current.assets).toHaveLength(0)
  })

  it('removes an asset', async () => {
    const existing = makeAsset()
    listDeckAssets.mockResolvedValueOnce([existing])
    deleteAsset.mockResolvedValueOnce()

    const { result } = renderHook(() => useDeckAssets(deckId))
    await waitFor(() => expect(result.current.assets).toHaveLength(1))

    await act(async () => {
      await result.current.removeAsset(existing.id)
    })

    expect(deleteAsset).toHaveBeenCalledWith(deckId, existing.id)
    expect(result.current.assets).toHaveLength(0)
  })

  it('does not upload when there is no deck', async () => {
    const { result } = renderHook(() => useDeckAssets(null))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.uploadFiles([new File(['x'], 'logo.png', { type: 'image/png' })])
    })

    expect(uploadDeckAsset).not.toHaveBeenCalled()
    expect(result.current.error).toContain('Save the deck')
  })
})
