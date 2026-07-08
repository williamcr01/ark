import { describe, expect, it } from 'vitest'

import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'

import {
  buildGeometryFieldOperation,
  buildResetImageAspectOperation,
  cssColorToHex,
  formatPercentValue,
  getInspectorDisabledReason,
  getInspectorElementKind,
  getInspectorKindLabel,
  normalizeFontWeight,
  normalizeTextAlign,
  parsePercentInput,
  showImageSection,
  showTextSection,
} from './element-inspector'

function makeSelection(overrides: Partial<EditorSelectionInfo> = {}): EditorSelectionInfo {
  return {
    elementId: 'ark-el-1',
    slideIndex: 0,
    slideId: 'ark-slide-1',
    tagName: 'div',
    locked: false,
    managed: true,
    editableKind: 'text-box',
    textPreview: 'Hello',
    imageFit: null,
    role: null,
    textStyle: {
      fontSize: 24,
      fontWeight: '400',
      color: 'rgb(15, 23, 42)',
      textAlign: 'left',
      lineHeight: 32,
    },
    imageNaturalSize: null,
    ...overrides,
  }
}

const geometry = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }

describe('getInspectorElementKind', () => {
  it('classifies text boxes, images, inline text, and generic elements', () => {
    expect(getInspectorElementKind(makeSelection())).toBe('text-box')
    expect(getInspectorElementKind(makeSelection({ editableKind: 'image', tagName: 'img' }))).toBe(
      'image',
    )
    expect(getInspectorElementKind(makeSelection({ editableKind: null, tagName: 'img' }))).toBe(
      'image',
    )
    expect(getInspectorElementKind(makeSelection({ editableKind: null, tagName: 'h1' }))).toBe(
      'text',
    )
    expect(getInspectorElementKind(makeSelection({ editableKind: null, tagName: 'div' }))).toBe(
      'element',
    )
  })

  it('maps kinds to labels', () => {
    expect(getInspectorKindLabel('text-box')).toBe('Text box')
    expect(getInspectorKindLabel('image')).toBe('Image')
    expect(getInspectorKindLabel('text')).toBe('Text')
    expect(getInspectorKindLabel('element')).toBe('Element')
  })
})

describe('section visibility', () => {
  it('shows the text section for text-like selections with computed styles', () => {
    expect(showTextSection(makeSelection())).toBe(true)
    expect(showTextSection(makeSelection({ editableKind: null, tagName: 'p' }))).toBe(true)
    expect(showTextSection(makeSelection({ textStyle: null }))).toBe(false)
    expect(showTextSection(makeSelection({ editableKind: 'image', tagName: 'img' }))).toBe(false)
    expect(showTextSection(makeSelection({ editableKind: null, tagName: 'div' }))).toBe(false)
  })

  it('shows the image section only for image selections', () => {
    expect(showImageSection(makeSelection({ editableKind: 'image', tagName: 'img' }))).toBe(true)
    expect(showImageSection(makeSelection())).toBe(false)
  })
})

describe('getInspectorDisabledReason', () => {
  it('returns null for editable managed selections', () => {
    expect(getInspectorDisabledReason(makeSelection())).toBeNull()
  })

  it('explains locked and unmanaged selections', () => {
    expect(getInspectorDisabledReason(makeSelection({ locked: true }))).toMatch(/locked/i)
    expect(getInspectorDisabledReason(makeSelection({ managed: false }))).toMatch(
      /not ark-managed/i,
    )
  })

  it('prefers the locked reason when both apply', () => {
    expect(getInspectorDisabledReason(makeSelection({ locked: true, managed: false }))).toMatch(
      /locked/i,
    )
  })
})

describe('buildGeometryFieldOperation', () => {
  it('builds move operations for x/y changes keeping the other axis', () => {
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'x', 0.5)).toEqual({
      op: 'move_element',
      elementId: 'ark-el-1',
      slideIndex: 0,
      slideId: 'ark-slide-1',
      x: 0.5,
      y: 0.2,
    })
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'y', 0.45)).toMatchObject({
      op: 'move_element',
      x: 0.1,
      y: 0.45,
    })
  })

  it('builds resize operations for width/height changes', () => {
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'width', 0.6)).toMatchObject({
      op: 'resize_element',
      width: 0.6,
      height: 0.1,
    })
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'height', 0.25)).toMatchObject({
      op: 'resize_element',
      width: 0.3,
      height: 0.25,
    })
  })

  it('clamps out-of-range values and skips no-op changes', () => {
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'x', 1.4)).toMatchObject({
      x: 1,
    })
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'y', -0.5)).toMatchObject({
      y: 0,
    })
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'x', 0.1)).toBeNull()
    expect(buildGeometryFieldOperation(makeSelection(), geometry, 'x', Number.NaN)).toBeNull()
  })

  it('omits slideId when the slide has no stable id', () => {
    const operation = buildGeometryFieldOperation(
      makeSelection({ slideId: null }),
      geometry,
      'x',
      0.5,
    )

    expect(operation).not.toHaveProperty('slideId')
  })
})

describe('buildResetImageAspectOperation', () => {
  const imageSelection = makeSelection({
    editableKind: 'image',
    tagName: 'img',
    textStyle: null,
    imageNaturalSize: { width: 800, height: 400 },
  })

  it('resizes height to match the intrinsic aspect ratio at the current width', () => {
    // width 0.3 → 384px wide; aspect 2 → 192px tall → 192/720 normalized.
    const operation = buildResetImageAspectOperation(imageSelection, geometry)

    expect(operation).toMatchObject({ op: 'resize_element', width: 0.3 })
    expect((operation as { height: number }).height).toBeCloseTo(192 / 720, 5)
  })

  it('returns null without intrinsic dimensions or when already matching', () => {
    expect(buildResetImageAspectOperation(makeSelection(), geometry)).toBeNull()

    const matching = { x: 0.1, y: 0.2, width: 0.3, height: 192 / 720 }
    expect(buildResetImageAspectOperation(imageSelection, matching)).toBeNull()
  })

  it('shrinks the width when the intrinsic height would overflow the slide', () => {
    const tall = makeSelection({
      editableKind: 'image',
      tagName: 'img',
      textStyle: null,
      imageNaturalSize: { width: 200, height: 800 },
    })
    const wide = { x: 0, y: 0, width: 0.9, height: 0.2 }
    const operation = buildResetImageAspectOperation(tall, wide)

    expect(operation).toMatchObject({ op: 'resize_element', height: 1 })
    expect((operation as { width: number }).width).toBeCloseTo(180 / 1280, 5)
  })
})

describe('percent formatting', () => {
  it('formats normalized values as one-decimal percentages', () => {
    expect(formatPercentValue(0.5)).toBe('50.0')
    expect(formatPercentValue(0.3333)).toBe('33.3')
    expect(formatPercentValue(1)).toBe('100.0')
  })

  it('parses percent inputs into clamped normalized units', () => {
    expect(parsePercentInput('42.5')).toBeCloseTo(0.425, 5)
    expect(parsePercentInput('42.5%')).toBeCloseTo(0.425, 5)
    expect(parsePercentInput('150')).toBe(1)
    expect(parsePercentInput('-10')).toBe(0)
    expect(parsePercentInput('abc')).toBeNull()
    expect(parsePercentInput('')).toBeNull()
  })
})

describe('text style normalization', () => {
  it('normalizes font weights to the nearest option', () => {
    expect(normalizeFontWeight('normal')).toBe('400')
    expect(normalizeFontWeight('bold')).toBe('700')
    expect(normalizeFontWeight('450')).toBe('400')
    expect(normalizeFontWeight('550')).toBe('500')
    expect(normalizeFontWeight('650')).toBe('600')
    expect(normalizeFontWeight('900')).toBe('700')
    expect(normalizeFontWeight('garbage')).toBe('400')
  })

  it('normalizes text alignment keywords', () => {
    expect(normalizeTextAlign('start')).toBe('left')
    expect(normalizeTextAlign('end')).toBe('right')
    expect(normalizeTextAlign('center')).toBe('center')
    expect(normalizeTextAlign('justify')).toBe('justify')
    expect(normalizeTextAlign('')).toBe('left')
  })

  it('converts computed colors to hex', () => {
    expect(cssColorToHex('rgb(15, 23, 42)')).toBe('#0f172a')
    expect(cssColorToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff0000')
    expect(cssColorToHex('#abcdef')).toBe('#abcdef')
    expect(cssColorToHex('#abc')).toBe('#aabbcc')
    expect(cssColorToHex('oklch(0.5 0.1 200)')).toBeNull()
  })
})
