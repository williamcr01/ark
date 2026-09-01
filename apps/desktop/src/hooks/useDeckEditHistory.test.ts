import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  EMPTY_HISTORY_STATE,
  recordDeckEdit,
  useDeckEditHistory,
  type DeckEditHistoryEntry,
} from './useDeckEditHistory'

function makeManualEntry(id: string, slideIndex = 0): DeckEditHistoryEntry {
  return {
    beforeHtml: `<before-${id}>`,
    afterHtml: `<after-${id}>`,
    slideIndex,
    provenance: {
      source: 'manual',
      operation: 'replace_text',
      operations: ['replace_text'],
      slideIndexes: [slideIndex],
      elementIds: [id],
      summary: `Edited ${id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

function makeAgentEntry(beforeHtml: string, afterHtml: string): DeckEditHistoryEntry {
  return {
    beforeHtml,
    afterHtml,
    slideIndex: 0,
    provenance: {
      source: 'agent',
      summary: 'Applied agent write',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

function makeExternalEntry(
  beforeHtml: string,
  afterHtml: string,
  toolName: string,
): DeckEditHistoryEntry {
  return {
    beforeHtml,
    afterHtml,
    slideIndex: 0,
    provenance: {
      source: 'external',
      clientName: 'Codex',
      toolName,
      summary: `Applied ${toolName}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

describe('recordDeckEdit coalescing', () => {
  it('does not record identical HTML (autosave / no-op debounce)', () => {
    const html = '<html>same</html>'
    const next = recordDeckEdit(EMPTY_HISTORY_STATE, makeAgentEntry(html, html))

    expect(next).toEqual(EMPTY_HISTORY_STATE)
  })

  it('keeps one stack entry per committed editor gesture', () => {
    const afterMove = recordDeckEdit(EMPTY_HISTORY_STATE, makeManualEntry('move'))
    const afterResize = recordDeckEdit(afterMove, makeManualEntry('resize'))

    expect(afterResize.stack).toHaveLength(2)
    expect(afterResize.pointer).toBe(1)
    expect(afterResize.stack.map((entry) => entry.afterHtml)).toEqual([
      '<after-move>',
      '<after-resize>',
    ])
  })

  it('records one stack entry per in-app agent write', () => {
    const first = recordDeckEdit(
      EMPTY_HISTORY_STATE,
      makeAgentEntry('<html>before</html>', '<html>turn-1</html>'),
    )
    const second = recordDeckEdit(
      first,
      makeAgentEntry('<html>turn-1</html>', '<html>turn-2</html>'),
    )

    expect(second.stack).toHaveLength(2)
    expect(second.stack[0]?.provenance.source).toBe('agent')
    expect(second.stack[1]?.afterHtml).toBe('<html>turn-2</html>')
  })

  it('coalesces consecutive MCP writes in one turn into a single entry', () => {
    const firstPatch = recordDeckEdit(
      EMPTY_HISTORY_STATE,
      makeExternalEntry('<html>start</html>', '<html>patch-1</html>', 'patch_element'),
    )
    const secondPatch = recordDeckEdit(
      firstPatch,
      makeExternalEntry('<html>patch-1</html>', '<html>patch-2</html>', 'patch_element'),
    )

    expect(secondPatch.stack).toHaveLength(1)
    expect(secondPatch.pointer).toBe(0)
    expect(secondPatch.stack[0]).toMatchObject({
      beforeHtml: '<html>start</html>',
      afterHtml: '<html>patch-2</html>',
      provenance: { source: 'external', toolName: 'patch_element' },
    })
  })

  it('does not coalesce an MCP write with a following editor gesture', () => {
    const afterMcp = recordDeckEdit(
      EMPTY_HISTORY_STATE,
      makeExternalEntry('<html>start</html>', '<html>mcp</html>', 'patch_deck'),
    )
    const afterGesture = recordDeckEdit(afterMcp, {
      ...makeManualEntry('nudge'),
      beforeHtml: '<html>mcp</html>',
      afterHtml: '<html>nudged</html>',
    })

    expect(afterGesture.stack).toHaveLength(2)
    expect(afterGesture.stack[1]?.provenance.source).toBe('manual')
  })

  it('does not coalesce an agent turn with a following MCP write', () => {
    const afterAgent = recordDeckEdit(
      EMPTY_HISTORY_STATE,
      makeAgentEntry('<html>start</html>', '<html>agent</html>'),
    )
    const afterMcp = recordDeckEdit(
      afterAgent,
      makeExternalEntry('<html>agent</html>', '<html>mcp</html>', 'edit_deck'),
    )

    expect(afterMcp.stack).toHaveLength(2)
    expect(afterMcp.stack.map((entry) => entry.provenance.source)).toEqual(['agent', 'external'])
  })

  it('forks the stack when a new edit lands after undo', () => {
    const twoSteps = recordDeckEdit(
      recordDeckEdit(EMPTY_HISTORY_STATE, makeManualEntry('a')),
      makeManualEntry('b'),
    )
    const afterUndo = { ...twoSteps, pointer: 0 }
    const forked = recordDeckEdit(afterUndo, makeManualEntry('c'))

    expect(forked.stack).toHaveLength(2)
    expect(forked.pointer).toBe(1)
    expect(
      forked.stack[1]?.provenance.source === 'manual' ? forked.stack[1].provenance.elementIds : [],
    ).toEqual(['c'])
  })
})

describe('useDeckEditHistory', () => {
  it('starts empty with nothing to undo or redo', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.undoEntry).toBeNull()
    expect(result.current.redoEntry).toBeNull()
  })

  it('records an edit and exposes it as undoable', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeManualEntry('a'))
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.undoEntry?.beforeHtml).toBe('<before-a>')
  })

  it('supports undo then redo of the same edit', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeManualEntry('a'))
    })

    act(() => {
      result.current.commitUndo()
    })

    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
    expect(result.current.redoEntry?.afterHtml).toBe('<after-a>')

    act(() => {
      result.current.commitRedo()
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('clears the redo stack after a new edit', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeManualEntry('a'))
      result.current.record(makeManualEntry('b'))
    })

    act(() => {
      result.current.commitUndo()
    })

    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.record(makeManualEntry('c'))
    })

    expect(result.current.canRedo).toBe(false)
    expect(
      result.current.undoEntry?.provenance.source === 'manual'
        ? result.current.undoEntry.provenance.elementIds
        : [],
    ).toEqual(['c'])
  })

  it('reset clears all history', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeManualEntry('a'))
      result.current.record(makeManualEntry('b'))
    })

    act(() => {
      result.current.reset()
    })

    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('tracks the slide each edit happened on', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeManualEntry('a', 2))
    })

    expect(result.current.undoEntry?.slideIndex).toBe(2)
  })

  it('ignores identical HTML recorded through the hook', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeAgentEntry('<html>same</html>', '<html>same</html>'))
    })

    expect(result.current.canUndo).toBe(false)
  })
})
