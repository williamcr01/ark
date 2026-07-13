import { describe, expect, it } from 'vitest'

import {
  createEditorEnableMessage,
  createEditorGeometryMessage,
  createEditorSelectionChangeMessage,
  createEditorTextCommitMessage,
  createEditorTextEditStateMessage,
  createEditorTransformCommitMessage,
  createEditorTransformPreviewMessage,
  buildDeckEditorBridgeRuntimeScript,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  isEditorMessage,
  isEditorRuntimeMessage,
  isEditorSelectionInfo,
  isEditorShellMessage,
  parseEditorMessage,
} from './deck-editor-bridge'
import { INLINE_TEXT_EDITABLE_TAGS } from './deck-editable'

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

  it('embeds shared inline text tags and text-edit lifecycle hooks in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    for (const tag of INLINE_TEXT_EDITABLE_TAGS) {
      expect(script).toContain(`"${tag}"`)
    }

    expect(script).toContain(EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE)
    expect(script).toContain('originalText')
    expect(script).toContain('ArrowLeft')
  })

  it('posts slideBounds with geometry and transform messages in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    expect(script).toContain('function normalizeSlideBounds')
    expect(script).toContain('slideBounds: normalizeSlideBounds(slide)')

    const selectHandler = script.indexOf('data.type === C.SELECT ||')
    const setIndex = script.indexOf('currentSlideIndex = data.slideIndex', selectHandler)
    const getSlide = script.indexOf('var slide = getActiveSlide();', setIndex)

    expect(selectHandler).toBeGreaterThan(-1)
    expect(setIndex).toBeGreaterThan(selectHandler)
    expect(getSlide).toBeGreaterThan(setIndex)
  })

  it('prefers the text-box wrapper over inner text elements as the editable target', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    const findTargetIndex = script.indexOf('function findEditableTarget')
    expect(findTargetIndex).toBeGreaterThan(-1)

    const ancestorPreferenceIndex = script.indexOf('findTextBoxAncestor(current, slide) || current')
    expect(ancestorPreferenceIndex).toBeGreaterThan(findTargetIndex)
  })

  it('deselects on empty-slide pointerdown in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    const emptyClickIndex = script.indexOf('var target = findEditableTarget(event.target, slide);')
    expect(emptyClickIndex).toBeGreaterThan(-1)

    const deselectIndex = script.indexOf(
      'postSelection(null, slide, currentSlideIndex);',
      emptyClickIndex,
    )
    expect(deselectIndex).toBeGreaterThan(emptyClickIndex)

    const hoverClearIndex = script.indexOf('elementId: null', deselectIndex)
    expect(hoverClearIndex).toBeGreaterThan(deselectIndex)
  })

  it('gates keyboard deletion to Ark-managed elements in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    const deleteHandlerIndex = script.indexOf("event.key === 'Delete'")
    expect(deleteHandlerIndex).toBeGreaterThan(-1)

    const managedGuardIndex = script.indexOf('!isManagedElement(selectedElement)')
    expect(managedGuardIndex).toBeGreaterThan(deleteHandlerIndex)
  })
})
