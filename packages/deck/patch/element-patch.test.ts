import { describe, expect, it } from 'vitest'

import {
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import { parseDeckHtml } from '../document/parser.ts'
import { arkManagedDeck, inlineSvgDeck } from './element/test-decks.ts'
import { applyDeckPatches } from './slide-ops.ts'

describe('applyDeckPatches element operations', () => {
  it('inserts, deletes, and updates attributes on managed elements', () => {
    const inserted = applyDeckPatches(
      arkManagedDeck,
      [
        {
          op: 'insert_element',
          slideId: 'ark-slide-title',
          html: '<p data-ark-role="callout">New callout</p>',
        },
      ],
      { activeSlideIndex: 0 },
    )

    expect(inserted.ok).toBe(true)
    if (!inserted.ok) {
      return
    }

    const insertedId = inserted.changedElementIds.find((id) => id.startsWith('ark-el-'))
    expect(insertedId).toBeTruthy()
    expect(inserted.html).toContain('New callout')
    expect(inserted.html).toContain(`${ARK_MANAGED_ATTR}="true"`)

    const attributed = applyDeckPatches(inserted.html, [
      {
        op: 'set_attrs',
        slideIndex: 0,
        elementId: insertedId!,
        attrs: { 'aria-label': 'Callout box' },
      },
    ])

    expect(attributed.ok).toBe(true)
    if (!attributed.ok) {
      return
    }

    expect(attributed.html).toContain('aria-label="Callout box"')

    const deleted = applyDeckPatches(attributed.html, [
      {
        op: 'delete_element',
        slideIndex: 0,
        elementId: insertedId!,
      },
    ])

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) {
      return
    }

    expect(deleted.html).not.toContain('New callout')
  })

  it('patches text-box wrappers as recognized editable targets (#84)', () => {
    const inserted = applyDeckPatches(arkManagedDeck, [
      {
        op: 'insert_element',
        slideIndex: 0,
        html: '<div class="ark-text-box" data-ark-editable="text-box" data-ark-managed="true" style="position:absolute;left:160px;top:144px;width:384px;min-height:58px;"><p>New text</p></div>',
      },
    ])

    expect(inserted.ok).toBe(true)
    if (!inserted.ok) {
      return
    }

    const wrapperId = inserted.changedElementIds[0]!
    expect(wrapperId).toBeTruthy()

    const patched = applyDeckPatches(inserted.html, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: wrapperId,
        x: 0.5,
        y: 0.25,
      },
      {
        op: 'set_inline_style',
        slideIndex: 0,
        elementId: wrapperId,
        style: { 'font-size': '32px', 'line-height': '40px', 'text-align': 'center' },
      },
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: wrapperId,
        direction: 'front',
      },
    ])

    expect(patched.ok).toBe(true)
    if (!patched.ok) {
      return
    }

    expect(patched.html).toContain(`left: ${Math.round(0.5 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(patched.html).toContain('font-size: 32px')
    expect(patched.html).toContain('line-height: 40px')
  })

  it('moves, resizes, and reorders managed elements using normalized geometry', () => {
    const patched = applyDeckPatches(arkManagedDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
        x: 0.1,
        y: 0.2,
      },
      {
        op: 'resize_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
        width: 0.5,
        height: 0.25,
        cssWidth: 0.4,
        cssHeight: 0.2,
      },
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
        zIndex: 5,
      },
    ])

    expect(patched.ok).toBe(true)
    if (!patched.ok) {
      return
    }

    const expectedLeft = `${Math.round(0.1 * ARK_SLIDE_REFERENCE_WIDTH)}px`
    const expectedTop = `${Math.round(0.2 * ARK_SLIDE_REFERENCE_HEIGHT)}px`
    const expectedWidth = `${Math.round(0.4 * ARK_SLIDE_REFERENCE_WIDTH)}px`
    const expectedHeight = `${Math.round(0.2 * ARK_SLIDE_REFERENCE_HEIGHT)}px`
    expect(patched.html).toContain(`left: ${expectedLeft}`)
    expect(patched.html).toContain(`top: ${expectedTop}`)
    expect(patched.html).toContain(`width: ${expectedWidth}`)
    expect(patched.html).toContain(`height: ${expectedHeight}`)
    expect(patched.html).toContain('z-index: 5')
    expect(patched.appliedCount).toBe(3)
  })

  it('adopts and resizes a transient element in one move_element', () => {
    const transientDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Transient</title></head>
<body>
  <section class="slide">
    <h1>Opening</h1>
  </section>
</body>
</html>`
    const elementId = parseDeckHtml(transientDeck).editableElements[0]?.elements.find(
      (element) => element.tagName === 'h1',
    )?.id

    expect(elementId).toMatch(/^transient-el-/)

    // move stamps a stable id; a follow-up resize under the same transient id would
    // fail assertElementPatchable — adopted resize must stay one operation.
    const moved = applyDeckPatches(transientDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: elementId!,
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.2,
        cssWidth: 0.5,
        cssHeight: 0.2,
        slideWidth: 1280,
        slideHeight: 720,
      },
    ])

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    expect(moved.changedElementIds.some((id) => id.startsWith('ark-el-'))).toBe(true)
    expect(moved.html).toContain('data-ark-managed="true"')
    expect(moved.html).toContain(`width: ${Math.round(0.5 * 1280)}px`)
    expect(moved.html).toContain(`height: ${Math.round(0.2 * 720)}px`)

    // Same-batch follow-up still uses the original transient id; stamping rewrites
    // both ops to the durable id before either runs so the resize still applies.
    const split = applyDeckPatches(transientDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: elementId!,
        x: 0.1,
        y: 0.2,
        width: 0.5,
      },
      {
        op: 'resize_element',
        slideIndex: 0,
        elementId: elementId!,
        width: 0.5,
        height: 0.2,
      },
    ])

    expect(split.ok).toBe(true)
    if (!split.ok) {
      return
    }

    expect(split.changedElementIds.some((id) => id.startsWith('ark-el-'))).toBe(true)
    expect(split.html).toContain(`height: ${Math.round(0.2 * 720)}px`)
  })

  it('moves, resizes, and duplicates an inline SVG element', () => {
    const patched = applyDeckPatches(inlineSvgDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-svg',
        x: 0.25,
        y: 0.1,
        width: 0.4,
      },
      {
        op: 'resize_element',
        slideIndex: 0,
        elementId: 'ark-el-svg',
        width: 0.5,
        height: 0.25,
      },
      {
        op: 'duplicate_element',
        slideIndex: 0,
        elementId: 'ark-el-svg',
      },
    ])

    expect(patched.ok).toBe(true)
    if (!patched.ok) {
      return
    }

    expect(patched.html).toMatch(/<svg[^>]*data-ark-managed="true"/)
    expect(patched.html).toContain(`left: ${Math.round(0.25 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(patched.html).toContain(`top: ${Math.round(0.1 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
    expect(patched.html).toContain(`width: ${Math.round(0.5 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(patched.html).toContain(`height: ${Math.round(0.25 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
    expect(patched.html.match(/<svg/g)).toHaveLength(2)
  })

  it('can mix slide and element operations in one request', () => {
    const result = applyDeckPatches(arkManagedDeck, [
      { op: 'update_slide_title', slideIndex: 1, title: 'Renamed second slide' },
      {
        op: 'replace_text',
        slideIndex: 1,
        elementId: 'ark-el-title-2',
        text: 'Renamed heading',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const parsed = parseDeckHtml(result.html)
    expect(parsed.slides[1]?.title).toBe('Renamed heading')
    expect(result.html).toContain('data-title="Renamed second slide"')
    expect(result.changedSlideIndexes).toEqual([1])
    expect(result.appliedCount).toBe(2)
  })
})
