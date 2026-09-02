import { toast } from 'sonner'

import { importPptx } from '@/lib/api/deck-api'
import {
  basenameFromPath,
  fileToBase64,
  isLegacyPptFile,
  isPptxFile,
  PPTX_LEGACY_UPLOAD_MESSAGE,
} from '@/lib/deck/deck-io'

export async function importPptxFromPath(path: string) {
  const filename = basenameFromPath(path)
  const pending = toast.loading('Importing PowerPoint...')
  try {
    const deck = await importPptx({ path, filename })
    toast.success(`Imported ${filename}`, { id: pending })
    return deck
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not import that PowerPoint file', {
      id: pending,
    })
    return null
  }
}

export async function importPptxFromFile(file: File) {
  if (isLegacyPptFile(file)) {
    toast.error(PPTX_LEGACY_UPLOAD_MESSAGE)
    return null
  }
  if (!isPptxFile(file)) {
    toast.error('Import a .pptx file')
    return null
  }
  const pending = toast.loading('Importing PowerPoint...')
  try {
    const deck = await importPptx({ filename: file.name, bytes: await fileToBase64(file) })
    toast.success(`Imported ${file.name}`, { id: pending })
    return deck
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not import that PowerPoint file', {
      id: pending,
    })
    return null
  }
}

export function isPowerPointPath(path: string) {
  return isPptxFile(path) || isLegacyPptFile(path)
}
