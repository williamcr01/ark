import { describe, expect, it } from 'vitest'

import {
  createEditorGeometryMessage,
  createEditorReadyMessage,
  createEditorSelectionChangeMessage,
  createEditorTransformCommitMessage,
} from '@ark/editor-runtime'

import { INITIAL_EDITOR_BRIDGE_STATE } from './editor-bridge-state.ts'
import { reduceEditorRuntimeMessage } from './editor-bridge-messages.ts'

describe('reduceEditorRuntimeMessage', () => {
  it('marks the editor ready', () => {
    const next = reduceEditorRuntimeMessage(
      INITIAL_EDITOR_BRIDGE_STATE,
      createEditorReadyMessage(0),
      null,
    )
    expect(next?.state.editorReady).toBe(true)
  })

  it('drops overlay geometry when selection identity changes', () => {
    const selected = reduceEditorRuntimeMessage(
      {
        ...INITIAL_EDITOR_BRIDGE_STATE,
        geometry: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
      createEditorSelectionChangeMessage({
        elementId: 'ark-el-title',
        slideIndex: 0,
        slideId: null,
        tagName: 'h1',
        locked: false,
        managed: false,
        editableKind: null,
        textPreview: 'Title',
      }),
      null,
    )
    expect(selected?.state.selection?.elementId).toBe('ark-el-title')

    const moved = reduceEditorRuntimeMessage(
      {
        ...selected!.state,
        geometry: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
      createEditorSelectionChangeMessage({
        elementId: 'ark-el-body',
        slideIndex: 0,
        slideId: null,
        tagName: 'p',
        locked: false,
        managed: false,
        editableKind: null,
        textPreview: 'Body',
      }),
      selected!.selectionIdentity,
    )
    expect(moved?.state.geometry).toBeNull()
    expect(moved?.publishPreview).toBeNull()
  })

  it('ignores late geometry and commits for a previous selection', () => {
    const current = {
      ...INITIAL_EDITOR_BRIDGE_STATE,
      selection: {
        elementId: 'ark-el-body',
        slideIndex: 0,
        slideId: null,
        tagName: 'p',
        locked: false,
        managed: false,
        editableKind: null,
        textPreview: 'Body',
      },
      selections: [
        {
          elementId: 'ark-el-body',
          slideIndex: 0,
          slideId: null,
          tagName: 'p',
          locked: false,
          managed: false,
          editableKind: null,
          textPreview: 'Body',
        },
      ],
    }
    const geometry = reduceEditorRuntimeMessage(
      current,
      createEditorGeometryMessage('ark-el-title', 0, { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }),
      { elementId: 'ark-el-body', slideIndex: 0 },
    )
    expect(geometry?.state.geometry).toBeNull()

    const commit = reduceEditorRuntimeMessage(
      current,
      createEditorTransformCommitMessage('ark-el-title', 0, {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.1,
      }),
      { elementId: 'ark-el-body', slideIndex: 0 },
    )
    expect(commit).toBeNull()
  })
})
