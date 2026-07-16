import { describe, expect, it } from 'vitest'

import { createEditorTransformCommitMessage } from '@ark/deck-core/deck-editor-bridge.ts'
import {
  buildTextBoxInsertOperation,
  buildTransformPatchOperations,
} from './deck-editor-patches.ts'
import { buildImageInsertOperation } from './deck-image-insert.ts'

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

  it('builds insert_element operations for embedded images', () => {
    expect(
      buildImageInsertOperation(
        0,
        {
          asset: { kind: 'data-url', mimeType: 'image/png', dataUrl: tinyPngDataUrl },
          geometry: { x: 0.1, y: 0.15, width: 0.4, height: 0.225 },
          aspectRatio: 16 / 9,
        },
        'slide-1',
        { alt: 'Logo' },
      ),
    ).toEqual({
      op: 'insert_element',
      slideIndex: 0,
      slideId: 'slide-1',
      html: expect.stringContaining('data-ark-editable="image"'),
    })
  })

  it('maps transform commits to move and resize patch operations', () => {
    const commit = createEditorTransformCommitMessage(
      'ark-el-body',
      0,
      { x: 0.2, y: 0.25, width: 0.4, height: 0.15 },
      undefined,
      undefined,
      undefined,
      -0.05,
      0.1,
      0.35,
      0.12,
      960,
      700,
    )

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
        cssX: -0.05,
        cssY: 0.1,
        slideWidth: 960,
        slideHeight: 700,
      },
      {
        op: 'resize_element',
        elementId: 'ark-el-body',
        slideIndex: 0,
        width: 0.4,
        height: 0.15,
        cssWidth: 0.35,
        cssHeight: 0.12,
        slideWidth: 960,
        slideHeight: 700,
      },
    ])
  })

  it('adopts flow elements with one width-preserving move', () => {
    const commit = createEditorTransformCommitMessage(
      'ark-el-heading',
      0,
      { x: 0.2, y: 0.25, width: 0.4, height: 0.15 },
      undefined,
      undefined,
      true,
      -0.05,
      0.1,
      0.35,
      undefined,
      960,
      700,
    )

    expect(
      buildTransformPatchOperations(commit, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, null),
    ).toEqual([
      {
        op: 'move_element',
        elementId: 'ark-el-heading',
        slideIndex: 0,
        x: 0.2,
        y: 0.25,
        cssX: -0.05,
        cssY: 0.1,
        cssWidth: 0.35,
        slideWidth: 960,
        slideHeight: 700,
        width: 0.4,
      },
    ])
  })
})
