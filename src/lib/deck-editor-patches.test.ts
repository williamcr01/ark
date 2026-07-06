import { describe, expect, it } from 'vitest'

import { createEditorTransformCommitMessage } from '../../shared/deck-editor-bridge.ts'
import {
  buildTextBoxInsertOperation,
  buildTransformPatchOperations,
} from './deck-editor-patches.ts'

describe('deck-editor-patches', () => {
  it('builds insert_element operations for text boxes', () => {
    expect(
      buildTextBoxInsertOperation(1, { x: 0.1, y: 0.2, width: 0.3, height: 0.08 }, 'slide-1'),
    ).toEqual({
      op: 'insert_element',
      slideIndex: 1,
      slideId: 'slide-1',
      html: expect.stringContaining('class="ark-text-box"'),
    })
  })

  it('maps transform commits to move and resize patch operations', () => {
    const commit = createEditorTransformCommitMessage('ark-el-body', 0, {
      x: 0.2,
      y: 0.25,
      width: 0.4,
      height: 0.15,
    })

    expect(
      buildTransformPatchOperations(
        commit,
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
        },
        null,
      ),
    ).toEqual([
      {
        op: 'move_element',
        elementId: 'ark-el-body',
        slideIndex: 0,
        x: 0.2,
        y: 0.25,
      },
      {
        op: 'resize_element',
        elementId: 'ark-el-body',
        slideIndex: 0,
        width: 0.4,
        height: 0.15,
      },
    ])
  })
})
