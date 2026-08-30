import { describe, expect, it } from 'vitest'

import type { EditorSelectionInfo } from '@ark/editor-runtime'

import { toEditorSelectionContext } from './editor-selection-context'

const baseSelection: EditorSelectionInfo = {
  elementId: 'ark-el-1',
  slideIndex: 3,
  slideId: 'ark-slide-1',
  tagName: 'h1',
  locked: false,
  managed: true,
  editableKind: 'text',
  textPreview: 'Our Mission',
}

describe('toEditorSelectionContext', () => {
  it('returns undefined when nothing is selected', () => {
    expect(toEditorSelectionContext(null)).toBeUndefined()
  })

  it('maps a full selection into the request context', () => {
    expect(toEditorSelectionContext(baseSelection)).toEqual({
      slideIndex: 3,
      slideId: 'ark-slide-1',
      elementId: 'ark-el-1',
      elementKind: 'text',
      textPreview: 'Our Mission',
      locked: false,
      managed: true,
    })
  })

  it('omits empty optional fields and truncates long text previews', () => {
    const context = toEditorSelectionContext({
      ...baseSelection,
      slideId: null,
      editableKind: null,
      textPreview: 'x'.repeat(500),
    })

    expect(context).not.toHaveProperty('slideId')
    expect(context).not.toHaveProperty('elementKind')
    expect(context?.textPreview?.length).toBe(280)
  })
})
