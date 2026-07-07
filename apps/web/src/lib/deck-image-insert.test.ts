import { describe, expect, it } from 'vitest'

import {
  clientPointToNormalizedSlidePoint,
  isEditableClipboardTarget,
} from './deck-image-insert.ts'

describe('clientPointToNormalizedSlidePoint', () => {
  it('maps client coordinates within the preview stage bounds', () => {
    const stage = document.createElement('div')
    stage.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 400,
        height: 225,
        right: 500,
        bottom: 275,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect

    expect(clientPointToNormalizedSlidePoint(300, 162.5, stage)).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  it('falls back to center when stage is missing', () => {
    expect(clientPointToNormalizedSlidePoint(0, 0, null)).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('isEditableClipboardTarget', () => {
  it('detects focused text inputs', () => {
    const input = document.createElement('input')
    document.body.append(input)

    expect(isEditableClipboardTarget(input)).toBe(true)

    input.remove()
  })

  it('ignores non-editable preview surfaces', () => {
    const surface = document.createElement('div')
    document.body.append(surface)

    expect(isEditableClipboardTarget(surface)).toBe(false)

    surface.remove()
  })
})
