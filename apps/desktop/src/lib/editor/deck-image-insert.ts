import type { EditorNormalizedRect } from '@ark/editor-runtime'
import {
  buildImageHtml,
  computeImageGeometry,
  type DeckAssetRef,
  type ImageFitMode,
  validateImageFile,
  validateImageSrcForInsert,
} from '@ark/deck/document/image.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { buildArkAssetUrl } from '@ark/deck/document/assets.ts'
import { uploadDeckAsset } from '../api/asset-api'

export type PreparedImageInsert = {
  asset: Extract<DeckAssetRef, { kind: 'asset-id' }>
  geometry: EditorNormalizedRect
  aspectRatio: number
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not read the image file.'))
    }

    reader.onerror = () => {
      reject(new Error('Could not read the image file.'))
    }

    reader.readAsDataURL(file)
  })
}

export async function loadImageDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }

    image.onerror = () => {
      reject(new Error('Could not decode the image.'))
    }

    image.src = dataUrl
  })
}

export async function prepareImageInsertFromFile(
  deckId: string,
  file: File,
  position?: { x: number; y: number },
): Promise<PreparedImageInsert> {
  const validation = validateImageFile(file)

  if (!validation.ok) {
    throw new Error(validation.error)
  }

  const dataUrl = await readFileAsDataUrl(file)
  const srcValidation = validateImageSrcForInsert(dataUrl)

  if (!srcValidation.ok) {
    throw new Error(srcValidation.error)
  }

  const dimensions = await loadImageDimensions(dataUrl)
  const geometry = computeImageGeometry(dimensions.width, dimensions.height, { position })
  const aspectRatio = dimensions.width / dimensions.height
  const uploaded = await uploadDeckAsset(deckId, {
    filename: file.name,
    mediaType: file.type,
    data: dataUrl,
  })

  return {
    asset: {
      kind: 'asset-id',
      id: uploaded.id,
      url: buildArkAssetUrl(uploaded.id),
    },
    geometry,
    aspectRatio,
  }
}

export function buildImageInsertOperation(
  slideIndex: number,
  prepared: PreparedImageInsert,
  slideId: string | null,
  options: { alt?: string; fit?: ImageFitMode } = {},
): DeckElementPatchOperation {
  return {
    op: 'insert_element',
    slideIndex,
    ...(slideId ? { slideId } : {}),
    html: buildImageHtml(prepared.geometry, prepared.asset, {
      alt: options.alt,
      fit: options.fit,
      aspectRatio: prepared.aspectRatio,
    }),
  }
}

export function clientPointToNormalizedSlidePoint(
  clientX: number,
  clientY: number,
  stage: HTMLElement | null,
): { x: number; y: number } {
  if (!stage) {
    return { x: 0.5, y: 0.5 }
  }

  const rect = stage.getBoundingClientRect()

  if (!rect.width || !rect.height) {
    return { x: 0.5, y: 0.5 }
  }

  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))

  return { x, y }
}

export function isEditableClipboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
