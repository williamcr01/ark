import { afterEach, describe, expect, it, vi } from 'vitest'

import { deleteAsset, listDeckAssets, uploadDeckAsset, uploadTemporaryAsset } from './asset-api'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

const asset = {
  id: '00000000-0000-4000-8000-000000000701',
  deckId,
  chatMessageId: null,
  filename: 'logo.png',
  mediaType: 'image/png',
  category: 'image' as const,
  byteSize: 128,
  checksum: 'abc',
  source: 'upload' as const,
  storageKind: 'local',
  url: `/api/decks/${deckId}/assets/00000000-0000-4000-8000-000000000701`,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const jsonResponse = (body: unknown, options: { ok?: boolean; status?: number } = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => body,
})

describe('asset-api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads an asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ asset }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      uploadDeckAsset(deckId, {
        filename: 'logo.png',
        mediaType: 'image/png',
        data: 'data:image/png;base64,AAAA',
      }),
    ).resolves.toEqual(asset)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deckId}/assets`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('stages an asset before a deck exists', async () => {
    const temporary = { ...asset, deckId: null, url: `/api/assets/${asset.id}` }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ asset: temporary }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      uploadTemporaryAsset({
        filename: 'logo.png',
        mediaType: 'image/png',
        data: 'data:image/png;base64,AAAA',
      }),
    ).resolves.toEqual(temporary)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assets',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('lists deck assets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assets: [asset] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listDeckAssets(deckId)).resolves.toEqual([asset])
    expect(fetchMock).toHaveBeenCalledWith(`/api/decks/${deckId}/assets`, expect.anything())
  })

  it('deletes an asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteAsset(deckId, asset.id)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/decks/${deckId}/assets/${asset.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('surfaces upload errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'Unsupported file type.' }, { ok: false, status: 400 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      uploadDeckAsset(deckId, {
        filename: 'a.exe',
        mediaType: 'application/x-msdownload',
        data: 'x',
      }),
    ).rejects.toThrow('Unsupported file type.')
  })
})
