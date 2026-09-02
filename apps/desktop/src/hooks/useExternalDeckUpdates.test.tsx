import { createRef, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useExternalDeckUpdates } from './useExternalDeckUpdates'
import { WorkspaceRuntimeContext, type WorkspaceRuntimeValue } from './workspace-runtime-context'

const refreshActiveDeck = vi.fn()
const record = vi.fn()

vi.mock('./useDeckEditHistory', () => ({
  useDeckEditHistory: () => ({
    record,
    canUndo: false,
    canRedo: false,
    undoEntry: null,
    redoEntry: null,
    commitUndo: vi.fn(),
    commitRedo: vi.fn(),
    reset: vi.fn(),
  }),
}))

function renderUpdates(overrides: Record<string, unknown> = {}) {
  const htmlRef = createRef<string>()
  htmlRef.current = '<html>after</html>'
  const value = {
    persistence: {
      deckId: 'deck-1',
      documentRevision: 1,
      isSaving: false,
      isPatching: false,
      refreshActiveDeck,
      ...overrides,
    },
    generation: { isGenerating: false },
    htmlRef,
    readHistorySlideIndex: () => 5,
  } as unknown as WorkspaceRuntimeValue

  return renderHook(() => useExternalDeckUpdates(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>
    ),
  })
}

describe('useExternalDeckUpdates', () => {
  beforeEach(() => {
    refreshActiveDeck.mockReset()
    record.mockReset()
  })
  it('refreshes a newer update for the visible deck', async () => {
    refreshActiveDeck.mockResolvedValue({
      id: 'deck-1',
      html: '<html>external</html>',
      documentRevision: 2,
    })
    renderUpdates()
    const listener = vi.mocked(window.arkDesktop.mcp.onDeckUpdated).mock.calls.at(-1)?.[0]
    expect(listener).toEqual(expect.any(Function))

    act(() => {
      listener?.({
        deckId: 'deck-1',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Codex',
        toolName: 'edit_deck',
        summary: 'Updated',
      })
    })

    await waitFor(() => {
      expect(refreshActiveDeck).toHaveBeenCalledWith('deck-1')
    })
    await waitFor(() => {
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeHtml: '<html>after</html>',
          afterHtml: '<html>external</html>',
          slideIndex: 5,
          provenance: expect.objectContaining({ source: 'external', clientName: 'Codex' }),
        }),
      )
    })
  })

  it('ignores updates for another deck', async () => {
    renderUpdates()
    const listener = vi.mocked(window.arkDesktop.mcp.onDeckUpdated).mock.calls.at(-1)?.[0]
    act(() => {
      listener?.({
        deckId: 'deck-2',
        previousDocumentRevision: 1,
        documentRevision: 2,
        clientName: 'Codex',
        toolName: 'edit_deck',
        summary: 'Other',
      })
    })
    expect(refreshActiveDeck).not.toHaveBeenCalled()
  })
})
