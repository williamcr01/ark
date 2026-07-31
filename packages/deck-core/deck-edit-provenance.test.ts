import { describe, expect, it } from 'vitest'

import { buildManualEditProvenance, summarizeManualEditOperations } from './deck-edit-provenance.ts'
import type { DeckElementPatchOperation } from './deck-patch.ts'

describe('summarizeManualEditOperations', () => {
  it('labels a single replace_text edit', () => {
    expect(summarizeManualEditOperations([{ op: 'replace_text', elementId: 'a', text: 'x' }])).toBe(
      'Edited text',
    )
  })

  it('coalesces a move + resize drag into one label', () => {
    const operations: DeckElementPatchOperation[] = [
      { op: 'move_element', elementId: 'a', x: 0.1, y: 0.2 },
      { op: 'resize_element', elementId: 'a', width: 0.3, height: 0.4 },
    ]

    expect(summarizeManualEditOperations(operations)).toBe('Moved and resized element')
  })

  it('describes mixed batches by count', () => {
    const operations: DeckElementPatchOperation[] = [
      { op: 'replace_text', elementId: 'a', text: 'x' },
      { op: 'delete_element', elementId: 'b' },
    ]

    expect(summarizeManualEditOperations(operations)).toBe('Applied 2 edits')
  })

  it('falls back for an empty batch', () => {
    expect(summarizeManualEditOperations([])).toBe('Edited deck')
  })
})

describe('buildManualEditProvenance', () => {
  it('records slide reorder provenance', () => {
    expect(
      buildManualEditProvenance({
        operations: [{ op: 'reorder_slide', slideIndex: 0, toIndex: 2 }],
        slideIndexes: [0, 2],
      }),
    ).toMatchObject({
      operation: 'reorder_slide',
      operations: ['reorder_slide'],
      slideIndexes: [0, 2],
      elementIds: [],
      summary: 'Reordered slide',
    })
  })

  it('uses server-reported slides and elements when provided', () => {
    const provenance = buildManualEditProvenance({
      operations: [{ op: 'replace_text', elementId: 'ark-el-0', slideIndex: 1, text: 'hi' }],
      summary: 'Edited text in preview',
      slideIndexes: [1],
      elementIds: ['ark-el-0'],
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(provenance).toEqual({
      source: 'manual',
      operation: 'replace_text',
      operations: ['replace_text'],
      slideIndexes: [1],
      elementIds: ['ark-el-0'],
      summary: 'Edited text in preview',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('derives slides, elements, and summary from operations when not supplied', () => {
    const provenance = buildManualEditProvenance({
      operations: [
        { op: 'move_element', elementId: 'ark-el-1', slideIndex: 2, x: 0.1, y: 0.2 },
        { op: 'resize_element', elementId: 'ark-el-1', slideIndex: 2, width: 0.3, height: 0.4 },
      ],
    })

    expect(provenance.source).toBe('manual')
    expect(provenance.operation).toBe('move_element')
    expect(provenance.operations).toEqual(['move_element', 'resize_element'])
    expect(provenance.slideIndexes).toEqual([2])
    expect(provenance.elementIds).toEqual(['ark-el-1'])
    expect(provenance.summary).toBe('Moved and resized element')
    expect(typeof provenance.createdAt).toBe('string')
  })
})
