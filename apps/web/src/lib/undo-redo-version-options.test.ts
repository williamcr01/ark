import { describe, expect, it } from 'vitest'

import type { DeckEditHistoryEntry } from '@/hooks/useDeckEditHistory'

import { buildUndoRedoVersionOptions } from './undo-redo-version-options'

const entry: DeckEditHistoryEntry = {
  beforeHtml: '<html>before</html>',
  afterHtml: '<html>after</html>',
  slideIndex: 0,
  provenance: {
    source: 'manual',
    operation: 'replace_text',
    operations: ['replace_text'],
    slideIndexes: [0, 2],
    elementIds: ['el-1', 'el-2'],
    summary: 'Edited text in preview',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}

describe('buildUndoRedoVersionOptions', () => {
  it('builds undo options with undo operation and entry slide/element ids', () => {
    expect(buildUndoRedoVersionOptions('undo', entry)).toEqual({
      summary: 'Undo: Edited text in preview',
      provenance: {
        operations: ['undo'],
        slideIndexes: [0, 2],
        elementIds: ['el-1', 'el-2'],
      },
    })
  })

  it('builds redo options symmetrically', () => {
    expect(buildUndoRedoVersionOptions('redo', entry)).toEqual({
      summary: 'Redo: Edited text in preview',
      provenance: {
        operations: ['redo'],
        slideIndexes: [0, 2],
        elementIds: ['el-1', 'el-2'],
      },
    })
  })

  it('omits empty slideIndexes and elementIds', () => {
    const sparseEntry: DeckEditHistoryEntry = {
      ...entry,
      provenance: {
        ...entry.provenance,
        slideIndexes: [],
        elementIds: [],
      },
    }

    expect(buildUndoRedoVersionOptions('undo', sparseEntry).provenance).toEqual({
      operations: ['undo'],
    })
  })
})
