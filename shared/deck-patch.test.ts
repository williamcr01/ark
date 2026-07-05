import { describe, expect, it } from 'vitest'

import {
  deckPatchOperationSchema,
  deckPatchRequestSchema,
  deckSlidePatchOperationSchema,
  isElementPatchOperation,
  isSlidePatchOperation,
  summarizePatchOperation,
} from './deck-patch.ts'

describe('deck patch schema', () => {
  it('accepts slide-level operations', () => {
    const operations = [
      { op: 'add_slide', html: '<section class="slide"><h1>New</h1></section>' },
      { op: 'delete_slide', slideIndex: 1 },
      {
        op: 'replace_slide',
        slideIndex: 0,
        html: '<section class="slide"><h1>Replaced</h1></section>',
      },
      { op: 'reorder_slide', slideIndex: 2, toIndex: 0 },
      { op: 'update_slide_title', slideIndex: 0, title: 'Renamed' },
      { op: 'update_slide_notes', slideId: 'ark-slide-abc', notes: 'Remember the roadmap.' },
    ]

    for (const operation of operations) {
      expect(deckPatchOperationSchema.safeParse(operation).success).toBe(true)
      expect(isSlidePatchOperation(operation as never)).toBe(true)
    }
  })

  it('accepts element-level schema operations for shared contract', () => {
    const operation = {
      op: 'replace_text',
      elementId: 'ark-el-1',
      text: 'Updated copy',
    } as const

    expect(deckPatchOperationSchema.safeParse(operation).success).toBe(true)
    expect(isElementPatchOperation(operation)).toBe(true)
    expect(isSlidePatchOperation(operation)).toBe(false)
  })

  it('rejects slide targets without index or id', () => {
    const parsed = deckSlidePatchOperationSchema.safeParse({ op: 'delete_slide' })
    expect(parsed.success).toBe(false)
  })

  it('parses patch requests with active slide context', () => {
    const parsed = deckPatchRequestSchema.parse({
      operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'Hello' }],
      activeSlideIndex: 2,
    })

    expect(parsed.activeSlideIndex).toBe(2)
    expect(parsed.operations).toHaveLength(1)
  })

  it('summarizes operations for provenance', () => {
    expect(summarizePatchOperation({ op: 'reorder_slide', slideIndex: 2, toIndex: 0 })).toContain(
      'move slide',
    )
  })
})
