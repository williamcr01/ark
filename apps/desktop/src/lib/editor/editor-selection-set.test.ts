import { describe, expect, it } from 'vitest'

import type { EditorSelectionInfo } from '@ark/editor-runtime'

import { getSelectionSetBlockReason } from './editor-selection-set'

const unlocked: EditorSelectionInfo = {
  elementId: 'ark-el-1',
  slideIndex: 0,
  slideId: null,
  tagName: 'p',
  locked: false,
  managed: true,
  editableKind: 'text-box',
  textPreview: 'One',
}

describe('getSelectionSetBlockReason', () => {
  it('allows a single unlocked selection and a fully unlocked set', () => {
    expect(getSelectionSetBlockReason([])).toBeNull()
    expect(getSelectionSetBlockReason([unlocked])).toBeNull()
    expect(
      getSelectionSetBlockReason([unlocked, { ...unlocked, elementId: 'ark-el-2' }]),
    ).toBeNull()
  })

  it('blocks a mixed locked set with UI copy', () => {
    expect(
      getSelectionSetBlockReason([unlocked, { ...unlocked, elementId: 'ark-el-2', locked: true }]),
    ).toBe('Move, nudge, and delete need every selected element to be unlocked and not nested.')
  })

  it('blocks a nested parent+child set with mixed-selection copy', () => {
    expect(
      getSelectionSetBlockReason([
        unlocked,
        { ...unlocked, elementId: 'ark-el-2', nestedInSelection: true },
      ]),
    ).toBe('Move, nudge, and delete need every selected element to be unlocked and not nested.')
  })
})
