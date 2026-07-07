import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDeckEditHistory, type DeckEditHistoryEntry } from './useDeckEditHistory'

function makeEntry(id: string, slideIndex = 0): DeckEditHistoryEntry {
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
      result.current.record(makeEntry('a'))
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.undoEntry?.beforeHtml).toBe('<before-a>')
  })

  it('supports undo then redo of the same edit', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeEntry('a'))
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
      result.current.record(makeEntry('a'))
      result.current.record(makeEntry('b'))
    })

    act(() => {
      result.current.commitUndo()
    })

    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.record(makeEntry('c'))
    })

    expect(result.current.canRedo).toBe(false)
    expect(result.current.undoEntry?.provenance.elementIds).toEqual(['c'])
  })

  it('reset clears all history', () => {
    const { result } = renderHook(() => useDeckEditHistory())

    act(() => {
      result.current.record(makeEntry('a'))
      result.current.record(makeEntry('b'))
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
      result.current.record(makeEntry('a', 2))
    })

    expect(result.current.undoEntry?.slideIndex).toBe(2)
  })
})
