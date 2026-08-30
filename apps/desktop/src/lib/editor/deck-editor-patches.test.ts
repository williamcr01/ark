import { describe, expect, it } from 'vitest'

import { createEditorTransformCommitMessage } from '@ark/editor-runtime'
import {
  buildTextBoxInsertOperation,
  buildTransformPatchOperations,
} from './deck-editor-patches.ts'
import { buildImageInsertOperation } from './deck-image-insert.ts'

const assetId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

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
          asset: { kind: 'asset-id', id: assetId, url: `ark-asset:${assetId}` },
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

  it('persists adopted resizes as a single move operation', () => {
    const commit = createEditorTransformCommitMessage(
      'ark-el-heading',
      0,
      { x: 0.1, y: 0.2, width: 0.5, height: 0.2 },
      undefined,
      undefined,
      true,
      0.1,
      0.2,
      0.5,
      0.2,
      1280,
      720,
    )

    expect(
      buildTransformPatchOperations(commit, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, null),
    ).toEqual([
      {
        op: 'move_element',
        elementId: 'ark-el-heading',
        slideIndex: 0,
        x: 0.1,
        y: 0.2,
        cssX: 0.1,
        cssY: 0.2,
        cssWidth: 0.5,
        cssHeight: 0.2,
        slideWidth: 1280,
        slideHeight: 720,
        width: 0.5,
        height: 0.2,
      },
    ])
  })

  it('forwards an adoption spacer on move_element', () => {
    const spacer = {
      width: 400,
      height: 80,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 16,
      marginLeft: 0,
      display: 'block',
    }
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
      spacer,
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
        spacer,
      },
    ])
  })
})
