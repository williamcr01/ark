import { describe, expect, it } from 'vitest'

import type { EditorSelectionInfo } from '@ark/editor-runtime'

import {
  toEditorSelectionContext,
  toEditorSelectionJobFields,
  withEditorSelectionJobFields,
} from './editor-selection-context'

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

describe('toEditorSelectionJobFields', () => {
  it('populates both singular and array for one element', () => {
    expect(toEditorSelectionJobFields(baseSelection)).toEqual({
      editorSelection: {
        slideIndex: 3,
        slideId: 'ark-slide-1',
        elementId: 'ark-el-1',
        elementKind: 'text',
        textPreview: 'Our Mission',
        locked: false,
        managed: true,
      },
      editorSelections: [
        {
          slideIndex: 3,
          slideId: 'ark-slide-1',
          elementId: 'ark-el-1',
          elementKind: 'text',
          textPreview: 'Our Mission',
          locked: false,
          managed: true,
        },
      ],
    })
  })

  it('keeps the primary as last-interacted for a multi-element set', () => {
    const companion: EditorSelectionInfo = {
      ...baseSelection,
      elementId: 'ark-el-2',
      textPreview: 'Second',
    }
    const fields = toEditorSelectionJobFields(companion, [baseSelection, companion])
    expect(fields.editorSelection?.elementId).toBe('ark-el-2')
    expect(fields.editorSelections?.map((item) => item.elementId)).toEqual(['ark-el-1', 'ark-el-2'])
  })

  it('drops mixed-slide extras and caps at 32', () => {
    const extras = Array.from({ length: 40 }, (_, index) => ({
      ...baseSelection,
      elementId: `ark-el-${index}`,
      slideIndex: index === 5 ? 9 : 3,
    }))
    const fields = toEditorSelectionJobFields(extras[0]!, extras)
    expect(fields.editorSelections).toHaveLength(32)
    expect(fields.editorSelections?.some((item) => item.slideIndex !== 3)).toBe(false)
  })
})

describe('withEditorSelectionJobFields', () => {
  it('wraps a singular selection as a one-element array', () => {
    expect(
      withEditorSelectionJobFields({
        editorSelection: { slideIndex: 1, elementId: 'ark-el-9' },
      }),
    ).toEqual({
      editorSelection: { slideIndex: 1, elementId: 'ark-el-9' },
      editorSelections: [{ slideIndex: 1, elementId: 'ark-el-9' }],
    })
  })
})
