import { describe, expect, it } from 'vitest'

import {
  createEditorEnableMessage,
  createEditorGeometryMessage,
  createEditorSelectionChangeMessage,
  createEditorTransformCommitMessage,
  createEditorTransformPreviewMessage,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  isEditorMessage,
  isEditorRuntimeMessage,
  isEditorShellMessage,
  parseEditorMessage,
} from './deck-editor-bridge'

describe('deck editor bridge protocol', () => {
  const selection = {
    elementId: 'ark-el-title',
    slideIndex: 0,
    slideId: 'ark-slide-1',
    tagName: 'h1',
    locked: false,
    textPreview: 'Opening',
  }

  it('creates shell and runtime messages with validated shapes', () => {
    expect(createEditorEnableMessage(1, 'text')).toEqual({
      type: EDITOR_ENABLE_MESSAGE_TYPE,
      slideIndex: 1,
      tool: 'text',
    })

    expect(createEditorSelectionChangeMessage(selection)).toEqual({
      type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
      selection,
    })

    expect(
      createEditorGeometryMessage('ark-el-title', 0, { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }),
    ).toEqual({
      type: EDITOR_GEOMETRY_MESSAGE_TYPE,
      elementId: 'ark-el-title',
      slideIndex: 0,
      geometry: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      zIndex: null,
    })
  })

  it('keeps transform preview and commit messages distinct', () => {
    const geometry = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }

    expect(createEditorTransformPreviewMessage('ark-el-body', 0, geometry).type).toBe(
      EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    )
    expect(createEditorTransformCommitMessage('ark-el-body', 0, geometry).type).toBe(
      EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )
    expect(createEditorTransformPreviewMessage('ark-el-body', 0, geometry).type).not.toBe(
      createEditorTransformCommitMessage('ark-el-body', 0, geometry).type,
    )
  })

  it('validates editor messages and rejects malformed payloads', () => {
    expect(isEditorShellMessage(createEditorEnableMessage(0))).toBe(true)
    expect(isEditorRuntimeMessage(createEditorSelectionChangeMessage(selection))).toBe(true)
    expect(isEditorMessage({ type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE, text: 'Nope' })).toBe(false)
    expect(isEditorMessage({ type: 'ark:editor-evil', slideIndex: 0 })).toBe(false)
    expect(
      parseEditorMessage(
        createEditorTransformCommitMessage('ark-el-body', 0, {
          x: 0,
          y: 0,
          width: 0.2,
          height: 0.1,
        }),
      ),
    ).toMatchObject({ type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE })
    expect(parseEditorMessage(null)).toBeNull()
  })
})
