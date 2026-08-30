import { describe, expect, it } from 'vitest'

import { ARK_SLIDE_REFERENCE_HEIGHT, ARK_SLIDE_REFERENCE_WIDTH } from '../document/metadata.ts'
import {
  buildTextBoxHtml,
  clampNormalizedRect,
  DEFAULT_TEXT_BOX_NORMALIZED_SIZE,
  formatNormalizedToPixels,
  MIN_TEXT_BOX_NORMALIZED_SIZE,
  normalizedRectFromPoints,
  normalizedRectToInlineStyle,
} from './text-box.ts'

describe('deck-text-box', () => {
  it('clamps normalized geometry to the slide bounds', () => {
    expect(
      clampNormalizedRect({
        x: 0.95,
        y: 0.9,
        width: 0.2,
        height: 0.2,
      }),
    ).toEqual({
      x: 0.8,
      y: 0.8,
      width: 0.2,
      height: 0.2,
    })
  })

  it('enforces a minimum text box size', () => {
    expect(
      clampNormalizedRect({
        x: 0.1,
        y: 0.1,
        width: 0.01,
        height: 0.01,
      }),
    ).toEqual({
      x: 0.1,
      y: 0.1,
      width: MIN_TEXT_BOX_NORMALIZED_SIZE,
      height: MIN_TEXT_BOX_NORMALIZED_SIZE,
    })
  })

  it('builds a normalized rect from drag points', () => {
    expect(normalizedRectFromPoints(0.2, 0.3, 0.5, 0.6)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.3,
      height: 0.3,
    })
  })

  it('converts normalized geometry to reference pixel inline styles', () => {
    expect(
      normalizedRectToInlineStyle({
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.25,
      }),
    ).toEqual({
      position: 'absolute',
      left: formatNormalizedToPixels(0.1, ARK_SLIDE_REFERENCE_WIDTH),
      top: formatNormalizedToPixels(0.2, ARK_SLIDE_REFERENCE_HEIGHT),
      width: formatNormalizedToPixels(0.5, ARK_SLIDE_REFERENCE_WIDTH),
      'min-height': formatNormalizedToPixels(0.25, ARK_SLIDE_REFERENCE_HEIGHT),
      'z-index': '1',
    })
  })

  it('builds portable Ark-managed text box HTML', () => {
    const html = buildTextBoxHtml({
      x: 0.125,
      y: 0.2,
      width: DEFAULT_TEXT_BOX_NORMALIZED_SIZE.width,
      height: DEFAULT_TEXT_BOX_NORMALIZED_SIZE.height,
    })

    expect(html).toContain('class="ark-text-box"')
    expect(html).toContain('data-ark-editable="text-box"')
    expect(html).toContain('data-ark-managed="true"')
    expect(html).toContain('<p>New text</p>')
    expect(html).toContain('left: 160px')
    expect(html).toContain('top: 144px')
    expect(html).toContain('width: 384px')
  })
})
