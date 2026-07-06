import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DeckAssets, type DeckAssetsProps } from './DeckAssets'
import type { AssetMetadataResponse, AssetUploadState } from '@/hooks/useDeckAssets'

const asset: AssetMetadataResponse = {
  id: '00000000-0000-4000-8000-000000000701',
  deckId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  chatMessageId: null,
  filename: 'logo.png',
  mediaType: 'image/png',
  category: 'image',
  byteSize: 2048,
  checksum: 'abc',
  source: 'upload',
  storageKind: 'local',
  url: '/api/assets/00000000-0000-4000-8000-000000000701',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function renderDeckAssets(overrides: Partial<DeckAssetsProps> = {}) {
  const props: DeckAssetsProps = {
    assets: [asset],
    uploads: [],
    selectedAssetIds: [asset.id],
    error: '',
    onUploadFiles: vi.fn(),
    onRemoveAsset: vi.fn(),
    onToggleSelected: vi.fn(),
    onDismissUpload: vi.fn(),
    ...overrides,
  }

  render(<DeckAssets {...props} />)
  return props
}

describe('DeckAssets', () => {
  it('shows uploaded asset name, type, and size', () => {
    renderDeckAssets()

    expect(screen.getByText('logo.png')).toBeInTheDocument()
    expect(screen.getByText(/image\/png · 2.0 KB/)).toBeInTheDocument()
  })

  it('uploads picked files', async () => {
    const user = userEvent.setup()
    const props = renderDeckAssets({ assets: [] })

    const input = screen.getByLabelText('Upload deck assets') as HTMLInputElement
    const file = new File(['hello'], 'notes.csv', { type: 'text/csv' })
    await user.upload(input, file)

    expect(props.onUploadFiles).toHaveBeenCalledTimes(1)
    expect(props.onUploadFiles).toHaveBeenCalledWith([file])
  })

  it('toggles asset selection', async () => {
    const user = userEvent.setup()
    const props = renderDeckAssets()

    await user.click(screen.getByLabelText(`Include ${asset.filename} in the next message`))
    expect(props.onToggleSelected).toHaveBeenCalledWith(asset.id)
  })

  it('removes an asset', async () => {
    const user = userEvent.setup()
    const props = renderDeckAssets()

    await user.click(screen.getByLabelText(`Remove ${asset.filename}`))
    expect(props.onRemoveAsset).toHaveBeenCalledWith(asset.id)
  })

  it('shows an in-progress upload and a failed upload with its error', () => {
    const uploads: AssetUploadState[] = [
      {
        id: 'u1',
        filename: 'chart.png',
        byteSize: 10,
        mediaType: 'image/png',
        status: 'uploading',
      },
      {
        id: 'u2',
        filename: 'bad.exe',
        byteSize: 10,
        mediaType: 'application/x-msdownload',
        status: 'error',
        error: 'Unsupported type.',
      },
    ]

    renderDeckAssets({ assets: [], uploads })

    expect(screen.getByText('Uploading…')).toBeInTheDocument()
    expect(screen.getByText('Unsupported type.')).toBeInTheDocument()
  })

  it('renders a list-level error', () => {
    renderDeckAssets({ assets: [], error: 'Could not load deck assets.' })
    expect(screen.getByText('Could not load deck assets.')).toBeInTheDocument()
  })
})
