import {
  AlertCircleIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

import type { AssetCategory } from '@ark/deck-core/assets.ts'
import type { AssetMetadataResponse, AssetUploadState } from '@/hooks/useDeckAssets'
import { cn } from '@/lib/utils'

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CategoryIcon({ category }: { category: AssetCategory }) {
  if (category === 'image') {
    return <ImageIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
  }

  if (category === 'text') {
    return <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
  }

  return <FileIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}

export type DeckAssetsProps = {
  assets: AssetMetadataResponse[]
  uploads: AssetUploadState[]
  selectedAssetIds: string[]
  error: string
  onRemoveAsset: (assetId: string) => void | Promise<void>
  onToggleSelected: (assetId: string) => void
  onDismissUpload: (uploadId: string) => void
}

export function DeckAssets({
  assets,
  uploads,
  selectedAssetIds,
  error,
  onRemoveAsset,
  onToggleSelected,
  onDismissUpload,
}: DeckAssetsProps) {
  const hasItems = assets.length > 0 || uploads.length > 0
  if (!hasItems && !error) {
    return null
  }

  return (
    <section aria-label="Deck assets" className="mb-3">
      {error ? (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircleIcon aria-hidden className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {hasItems ? (
        <ul className="mb-2 flex flex-col gap-1.5">
          {uploads.map((upload) => (
            <li
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                upload.status === 'error'
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-border/60 bg-background',
              )}
              key={upload.id}
            >
              {upload.status === 'uploading' ? (
                <Loader2Icon
                  aria-hidden
                  className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                />
              ) : (
                <AlertCircleIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-foreground">{upload.filename}</span>
                {upload.status === 'error' ? (
                  <span className="truncate text-destructive">{upload.error}</span>
                ) : (
                  <span className="text-muted-foreground">Uploading…</span>
                )}
              </div>
              {upload.status === 'error' ? (
                <button
                  aria-label={`Dismiss ${upload.filename}`}
                  className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={() => onDismissUpload(upload.id)}
                  type="button"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}

          {assets.map((asset) => {
            const selected = selectedAssetIds.includes(asset.id)

            return (
              <li
                className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
                key={asset.id}
              >
                <input
                  aria-label={`Include ${asset.filename} in the next message`}
                  checked={selected}
                  className="size-3.5 shrink-0 accent-[var(--ark-accent)]"
                  onChange={() => onToggleSelected(asset.id)}
                  type="checkbox"
                />
                <CategoryIcon category={asset.category} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-foreground">{asset.filename}</span>
                  <span className="text-muted-foreground">
                    {asset.mediaType} · {formatBytes(asset.byteSize)}
                  </span>
                </div>
                <button
                  aria-label={`Remove ${asset.filename}`}
                  className="shrink-0 rounded-sm text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    void onRemoveAsset(asset.id)
                  }}
                  type="button"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
