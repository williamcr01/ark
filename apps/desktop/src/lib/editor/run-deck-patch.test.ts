import { describe, expect, it, vi } from 'vitest'

import { recordManualEdit, runDeckPatch } from './run-deck-patch.ts'

const { toast } = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('sonner', () => ({ toast }))

describe('runDeckPatch', () => {
  it('records history after a successful patch', async () => {
    const recordEditHistory = vi.fn()
    const result = await runDeckPatch(
      {
        deckId: 'deck-1',
        htmlRef: { current: '<html>before</html>' },
        patchDeckOperations: vi.fn().mockResolvedValue({
          beforeHtml: '<html>before</html>',
          deck: { html: '<html>after</html>' },
          patch: { changedSlideIndexes: [0], changedElementIds: ['el'] },
        }),
        recordEditHistory,
        refreshActiveDeck: vi.fn(),
      },
      [{ op: 'reorder_slide', slideIndex: 0, toIndex: 1 }],
      'Moved',
      0,
    )

    expect(result?.deck.html).toBe('<html>after</html>')
    expect(recordEditHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeHtml: '<html>before</html>',
        afterHtml: '<html>after</html>',
      }),
    )
  })

  it('skips recording when the patch result has no deck', () => {
    const htmlRef = { current: '<html>live</html>' }
    recordManualEdit(htmlRef, vi.fn(), '<html>live</html>', undefined, [], 'Edited', 0)
    expect(htmlRef.current).toBe('<html>live</html>')
  })

  it('toasts and throws when a required deck is missing', async () => {
    await expect(
      runDeckPatch(
        {
          deckId: null,
          htmlRef: { current: '' },
          patchDeckOperations: vi.fn(),
          recordEditHistory: vi.fn(),
          refreshActiveDeck: vi.fn(),
        },
        [],
        'Edited',
        0,
        { requireDeck: true, missingDeckMessage: 'Save the deck before editing text' },
      ),
    ).rejects.toThrow('Deck is not saved')
    expect(toast.error).toHaveBeenCalledWith('Save the deck before editing text')
  })

  it('uses a fixed failure toast for reorder errors', async () => {
    const refreshActiveDeck = vi.fn()
    await expect(
      runDeckPatch(
        {
          deckId: 'deck-1',
          htmlRef: { current: '<html>before</html>' },
          patchDeckOperations: vi.fn().mockRejectedValue(new Error('nope')),
          recordEditHistory: vi.fn(),
          refreshActiveDeck,
        },
        [{ op: 'reorder_slide', slideIndex: 0, toIndex: 1 }],
        'Moved',
        0,
        { fixedFailure: 'Could not reorder slide' },
      ),
    ).rejects.toThrow('nope')
    expect(refreshActiveDeck).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not reorder slide')
  })
})
