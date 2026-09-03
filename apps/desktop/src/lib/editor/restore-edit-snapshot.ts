import { toast } from 'sonner'

import { ApiResponseError } from '@ark/contracts'

export async function restoreEditSnapshot(options: {
  inFlightRef: { current: boolean }
  html: string | undefined
  restoreHtmlSnapshot: (html: string) => Promise<unknown>
  commit: () => void
  refreshActiveDeck: () => Promise<unknown>
  failureFallback: string
}): Promise<void> {
  if (options.inFlightRef.current || options.html == null) {
    return
  }

  options.inFlightRef.current = true
  try {
    const deck = await options.restoreHtmlSnapshot(options.html)
    if (deck) {
      options.commit()
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : options.failureFallback)
    try {
      await options.refreshActiveDeck()
    } catch {
      // Ignore refresh failures after a failed undo/redo.
    }
  } finally {
    options.inFlightRef.current = false
  }
}

export async function restoreDocumentRevision(options: {
  revision: number
  restoreFromHistory: (revision: number) => Promise<unknown>
  resetEditHistory: () => void
}): Promise<void> {
  try {
    await options.restoreFromHistory(options.revision)
    options.resetEditHistory()
    toast.success('Restored that version')
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'document_conflict') {
      toast.error('The deck changed. Reloaded the current version.')
    } else {
      toast.error(error instanceof Error ? error.message : 'Could not restore that version')
    }
    throw error
  }
}
