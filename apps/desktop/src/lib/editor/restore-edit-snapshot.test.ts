import { describe, expect, it, vi } from 'vitest'

import { ApiResponseError } from '@ark/contracts'

import { restoreDocumentRevision, restoreEditSnapshot } from './restore-edit-snapshot.ts'

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast }))

describe('restoreEditSnapshot', () => {
  it('commits after a successful snapshot restore', async () => {
    const commit = vi.fn()
    await restoreEditSnapshot({
      inFlightRef: { current: false },
      html: '<html>before</html>',
      restoreHtmlSnapshot: vi.fn().mockResolvedValue({ id: 'deck-1' }),
      commit,
      refreshActiveDeck: vi.fn(),
      failureFallback: 'Could not undo the last edit',
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('skips when no snapshot html is available', async () => {
    const restoreHtmlSnapshot = vi.fn()
    await restoreEditSnapshot({
      inFlightRef: { current: false },
      html: undefined,
      restoreHtmlSnapshot,
      commit: vi.fn(),
      refreshActiveDeck: vi.fn(),
      failureFallback: 'Could not undo the last edit',
    })
    expect(restoreHtmlSnapshot).not.toHaveBeenCalled()
  })
})

describe('restoreDocumentRevision', () => {
  it('toasts a conflict with the original copy', async () => {
    await expect(
      restoreDocumentRevision({
        revision: 3,
        restoreFromHistory: vi
          .fn()
          .mockRejectedValue(new ApiResponseError('conflict', { code: 'document_conflict' })),
        resetEditHistory: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ApiResponseError)
    expect(toast.error).toHaveBeenCalledWith('The deck changed. Reloaded the current version.')
  })
})
