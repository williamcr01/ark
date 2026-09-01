import { describe, expect, it } from 'vitest'

import {
  createEditorConfigureMessage,
  createEditorEnableMessage,
  createEditorGeometryMessage,
  createEditorHoverMessage,
  createEditorSelectionChangeMessage,
  createEditorShortcutMessage,
  createEditorTextCommitMessage,
  createEditorTextEditStateMessage,
  createEditorTransformCommitMessage,
  createEditorTransformCancelMessage,
  createEditorAssignIdMessage,
  createEditorTransformEndMessage,
  createEditorTransformPreviewMessage,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_CONFIGURE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_SHORTCUT_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  isEditorMessage,
  isEditorRuntimeMessage,
  isEditorSelectionInfo,
  isEditorShellMessage,
  parseEditorMessage,
  MAX_EDITOR_SELECTIONS,
} from '../index.ts'

describe('deck editor bridge protocol', () => {
  const selection = {
    elementId: 'ark-el-title',
    slideIndex: 0,
    slideId: 'ark-slide-1',
    tagName: 'h1',
    locked: false,
    managed: false,
    editableKind: null,
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

    expect(
      createEditorGeometryMessage(
        'ark-el-title',
        0,
        { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
        null,
        { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      ),
    ).toEqual({
      type: EDITOR_GEOMETRY_MESSAGE_TYPE,
      elementId: 'ark-el-title',
      slideIndex: 0,
      geometry: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      zIndex: null,
      slideBounds: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    })
  })

  it('keeps transform preview and commit messages distinct', () => {
    const geometry = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const slideBounds = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }

    expect(createEditorTransformPreviewMessage('ark-el-body', 0, geometry).type).toBe(
      EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    )
    expect(createEditorTransformCommitMessage('ark-el-body', 0, geometry).type).toBe(
      EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )
    expect(createEditorTransformPreviewMessage('ark-el-body', 0, geometry).type).not.toBe(
      createEditorTransformCommitMessage('ark-el-body', 0, geometry).type,
    )
    expect(
      createEditorTransformPreviewMessage('ark-el-body', 0, geometry, null, slideBounds),
    ).toMatchObject({ slideBounds })
    expect(
      createEditorTransformCommitMessage('ark-el-body', 0, geometry, 2, slideBounds),
    ).toMatchObject({ slideBounds, zIndex: 2 })
  })

  it('validates editor messages and rejects malformed payloads', () => {
    expect(isEditorShellMessage(createEditorEnableMessage(0))).toBe(true)
    expect(isEditorShellMessage(createEditorTransformCancelMessage())).toBe(true)
    expect(isEditorShellMessage(createEditorTransformEndMessage())).toBe(true)
    expect(
      isEditorShellMessage(createEditorAssignIdMessage('transient-el-0-0', 'ark-el-a', 0)),
    ).toBe(true)
    expect(isEditorRuntimeMessage(createEditorSelectionChangeMessage(selection))).toBe(true)
    expect(
      isEditorRuntimeMessage(
        createEditorTextCommitMessage('ark-el-title', 0, 'Updated', 'Opening', null),
      ),
    ).toBe(true)
    expect(isEditorRuntimeMessage(createEditorTextEditStateMessage(true, 'ark-el-title', 0))).toBe(
      true,
    )
    expect(isEditorRuntimeMessage(createEditorTextEditStateMessage(false))).toBe(true)
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

  it('validates optional editing overhaul fields and new messages', () => {
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }
    const slideBounds = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }

    expect(createEditorEnableMessage(0, 'select', 0.5)).toMatchObject({ scale: 0.5 })
    expect(createEditorConfigureMessage(0.5)).toEqual({
      type: EDITOR_CONFIGURE_MESSAGE_TYPE,
      scale: 0.5,
    })
    expect(isEditorSelectionInfo({ ...selection, surface: 'dark', geometryEditable: true })).toBe(
      true,
    )
    expect(
      isEditorRuntimeMessage(
        createEditorHoverMessage(0, 'ark-el-title', geometry, slideBounds, 'dark'),
      ),
    ).toBe(true)
    expect(
      isEditorRuntimeMessage(
        createEditorGeometryMessage('ark-el-title', 0, geometry, null, slideBounds, 'dark'),
      ),
    ).toBe(true)
    expect(
      isEditorRuntimeMessage(
        createEditorTransformCommitMessage(
          'ark-el-title',
          0,
          geometry,
          null,
          slideBounds,
          true,
          -0.1,
          0.2,
          0.5,
          0.25,
          960,
          700,
        ),
      ),
    ).toBe(true)
    expect(createEditorShortcutMessage('undo')).toEqual({
      type: EDITOR_SHORTCUT_MESSAGE_TYPE,
      action: 'undo',
    })
    expect(createEditorTransformCancelMessage()).toEqual({
      type: EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
    })
    expect(isEditorRuntimeMessage(createEditorTransformCancelMessage())).toBe(true)

    const invalidMessages = [
      { type: EDITOR_ENABLE_MESSAGE_TYPE, slideIndex: 0, scale: 0 },
      { type: EDITOR_CONFIGURE_MESSAGE_TYPE, scale: Number.NaN },
      createEditorSelectionChangeMessage({ ...selection, surface: 'medium' as never }),
      { ...createEditorHoverMessage(0, 'ark-el-title'), geometry: { ...geometry, x: 2 } },
      { ...createEditorGeometryMessage('ark-el-title', 0, geometry), surface: 'medium' },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), adopted: false },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), cssX: Number.NaN },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), cssX: 11 },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), cssHeight: Number.NaN },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), slideWidth: 0 },
      {
        ...createEditorTransformCommitMessage('ark-el-title', 0, geometry),
        spacer: {
          width: 0,
          height: 10,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 0,
          marginLeft: 0,
          display: 'block',
        },
      },
      { type: EDITOR_SHORTCUT_MESSAGE_TYPE, action: 'paste' },
    ]

    for (const message of invalidMessages) {
      expect(isEditorMessage(message)).toBe(false)
    }
  })

  it('accepts optional inspector selection fields (issue #84)', () => {
    expect(
      isEditorSelectionInfo({
        ...selection,
        role: 'title',
        textStyle: {
          fontSize: 32,
          fontWeight: '700',
          color: 'rgb(15, 23, 42)',
          textAlign: 'left',
          lineHeight: 40,
        },
        imageNaturalSize: null,
      }),
    ).toBe(true)

    expect(
      isEditorSelectionInfo({
        ...selection,
        role: null,
        textStyle: null,
        imageNaturalSize: { width: 800, height: 600 },
      }),
    ).toBe(true)

    // lineHeight "normal" is reported as null.
    expect(
      isEditorSelectionInfo({
        ...selection,
        textStyle: {
          fontSize: 18,
          fontWeight: '400',
          color: 'rgb(0, 0, 0)',
          textAlign: 'center',
          lineHeight: null,
        },
      }),
    ).toBe(true)
  })

  it('rejects malformed inspector selection fields', () => {
    expect(isEditorSelectionInfo({ ...selection, role: 5 })).toBe(false)
    expect(isEditorSelectionInfo({ ...selection, textStyle: { fontSize: 'big' } })).toBe(false)
    expect(
      isEditorSelectionInfo({
        ...selection,
        textStyle: {
          fontSize: 18,
          fontWeight: 400,
          color: 'rgb(0, 0, 0)',
          textAlign: 'left',
          lineHeight: null,
        },
      }),
    ).toBe(false)
    expect(isEditorSelectionInfo({ ...selection, imageNaturalSize: { width: 800 } })).toBe(false)
    expect(
      isEditorSelectionInfo({
        ...selection,
        imageNaturalSize: { width: Number.NaN, height: 10 },
      }),
    ).toBe(false)
  })

  it('rejects hostile editor payloads with invalid geometry and incomplete fields', () => {
    const hostilePayloads = [
      createEditorGeometryMessage('ark-el-title', 0, { x: 1.5, y: 0, width: 0.2, height: 0.1 }),
      createEditorGeometryMessage('ark-el-title', 0, { x: 0, y: -0.1, width: 0.2, height: 0.1 }),
      createEditorTransformCommitMessage('ark-el-body', 0, { x: 0, y: 0, width: 2, height: 0.1 }),
      {
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection: { elementId: 'evil', slideIndex: 0 },
      },
      {
        type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
        elementId: 'evil',
        slideIndex: 0,
        text: 'Injected',
      },
      {
        type: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
        active: true,
      },
      {
        type: EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
        elementId: 'evil',
        slideIndex: 0,
        geometry: { x: '0', y: 0, width: 0.2, height: 0.1 },
      },
    ]

    for (const payload of hostilePayloads) {
      expect(isEditorRuntimeMessage(payload)).toBe(false)
      expect(parseEditorMessage(payload)).toBeNull()
    }
  })

  it('accepts a same-slide selection set on ark:editor-selection-change', () => {
    const second = { ...selection, elementId: 'ark-el-body', tagName: 'p', textPreview: 'Body' }
    const message = createEditorSelectionChangeMessage(second, [selection, second])

    expect(message.selections).toEqual([selection, second])
    expect(isEditorRuntimeMessage(message)).toBe(true)
    expect(isEditorRuntimeMessage(createEditorSelectionChangeMessage(null))).toBe(true)
  })

  it('accepts a same-slide selection set of exactly 32', () => {
    const selections = Array.from({ length: MAX_EDITOR_SELECTIONS }, (_, index) => ({
      ...selection,
      elementId: `ark-el-${index}`,
    }))
    const primary = selections[selections.length - 1]!

    expect(
      isEditorRuntimeMessage({
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection: primary,
        selections,
      }),
    ).toBe(true)
  })

  it('accepts companion payloads on a group transform commit', () => {
    const geometry = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const commit = {
      ...createEditorTransformCommitMessage('ark-el-title', 0, geometry),
      companions: [
        {
          elementId: 'ark-el-body',
          slideIndex: 0,
          geometry: { x: 0.5, y: 0.3, width: 0.3, height: 0.2 },
        },
      ],
    }

    expect(isEditorRuntimeMessage(commit)).toBe(true)
    expect(
      isEditorRuntimeMessage({
        ...commit,
        companions: [{ elementId: '', slideIndex: 0, geometry }],
      }),
    ).toBe(false)
  })

  it('rejects a selection set that is mixed-slide, over cap, or missing the primary', () => {
    const second = { ...selection, elementId: 'ark-el-body', tagName: 'p' }

    expect(
      isEditorRuntimeMessage({
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection,
        selections: [{ ...second, slideIndex: 1 }],
      }),
    ).toBe(false)

    expect(
      isEditorRuntimeMessage({
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection,
        selections: [second],
      }),
    ).toBe(false)

    expect(
      isEditorRuntimeMessage({
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection: null,
        selections: [selection],
      }),
    ).toBe(false)

    expect(
      isEditorRuntimeMessage({
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection,
        selections: Array.from({ length: MAX_EDITOR_SELECTIONS + 1 }, (_, index) => ({
          ...selection,
          elementId: `ark-el-${index}`,
        })),
      }),
    ).toBe(false)
  })
})
