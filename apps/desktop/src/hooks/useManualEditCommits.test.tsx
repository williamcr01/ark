import { createRef, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { WorkspaceRuntimeContext, type WorkspaceRuntimeValue } from './workspace-runtime-context'
import { useManualEditCommits } from './useManualEditCommits'

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('sonner', () => ({ toast }))

const persistence = {
  deckId: 'deck-1',
  patchDeckOperations: vi.fn(),
  refreshActiveDeck: vi.fn(),
  restoreFromHistory: vi.fn(),
  restoreHtmlSnapshot: vi.fn(),
}

function wrapper({ children }: { children: ReactNode }) {
  const value = {
    persistence,
    htmlRef: createRef<string>(),
  } as unknown as WorkspaceRuntimeValue
  value.htmlRef.current = '<html>after</html>'
  return (
    <MemoryRouter>
      <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>
    </MemoryRouter>
  )
}

describe('useManualEditCommits', () => {
  beforeEach(() => {
    persistence.patchDeckOperations.mockReset()
    persistence.refreshActiveDeck.mockReset()
    persistence.restoreFromHistory.mockReset()
    persistence.restoreHtmlSnapshot.mockReset()
  })
  it('records separate undo snapshots for consecutive patches', async () => {
    persistence.patchDeckOperations
      .mockResolvedValueOnce({
        beforeHtml: '<html>after</html>',
        deck: { html: '<html>dragged</html>' },
        patch: { changedSlideIndexes: [0], changedElementIds: ['ark-el-1'] },
      })
      .mockResolvedValueOnce({
        beforeHtml: '<html>dragged</html>',
        deck: { html: '<html>duplicated</html>' },
        patch: { changedSlideIndexes: [0], changedElementIds: ['ark-el-2'] },
      })
    const { result } = renderHook(() => useManualEditCommits(), { wrapper })

    await act(async () => {
      await result.current.handlePatchEditorOperations([], 0, 'Dragged element')
      await result.current.handlePatchEditorOperations([], 0, 'Duplicated element')
    })

    expect(result.current.canUndo).toBe(true)
  })

  it('uses the remapped slide index when reordering', async () => {
    persistence.patchDeckOperations.mockResolvedValueOnce({
      beforeHtml: '<html>before</html>',
      deck: { html: '<html>reordered</html>' },
      patch: {
        changedSlideIndexes: [0, 2],
        changedElementIds: [],
        suggestedActiveSlideIndex: 2,
      },
      suggestedSlideIndex: 2,
    })
    const { result } = renderHook(() => useManualEditCommits(), { wrapper })

    await act(async () => {
      await result.current.handleReorderSlide(0, 2, 0)
    })

    expect(persistence.patchDeckOperations).toHaveBeenCalledWith(
      [{ op: 'reorder_slide', slideIndex: 0, toIndex: 2 }],
      0,
    )
  })

  it('toasts a fixed message when reorder fails', async () => {
    persistence.patchDeckOperations.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useManualEditCommits(), { wrapper })

    await act(async () => {
      await expect(result.current.handleReorderSlide(0, 1, 0)).rejects.toThrow('nope')
    })

    expect(toast.error).toHaveBeenCalledWith('Could not reorder slide')
    expect(persistence.refreshActiveDeck).toHaveBeenCalled()
  })
})
