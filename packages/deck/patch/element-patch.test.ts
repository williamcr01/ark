import { describe, expect, it } from 'vitest'

import {
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import { buildDeckAssetProxyUrl } from '@ark/deck/document/network.ts'
import { applyDeckPatches } from './slide-ops.ts'
import { parseDeckHtml } from '../document/parser.ts'

const arkManagedDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Managed Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-title">
    <h1 data-ark-id="ark-el-title" data-ark-editable="true" data-ark-role="title">Opening</h1>
    <p
      data-ark-id="ark-el-body"
      data-ark-managed="true"
      data-ark-editable="true"
      data-ark-role="body"
      style="position: absolute; left: 48px; top: 120px; width: 640px; height: 80px; z-index: 2;"
    >Managed body copy</p>
    <p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p>
    <aside class="notes">Speaker only</aside>
  </section>
  <section class="slide" data-ark-slide-id="ark-slide-second">
    <h2 data-ark-id="ark-el-title-2" data-ark-editable="true">Second slide</h2>
  </section>
</body>
</html>`

const arkManagedLinkDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Managed Link Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-title">
    <a
      data-ark-id="ark-el-link"
      data-ark-managed="true"
      data-ark-editable="true"
      href="/internal/link"
      style="position: absolute; left: 48px; top: 220px; width: 420px; z-index: 3;"
    >Managed link</a>
  </section>
</body>
</html>`

const inlineSvgDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>SVG</title></head>
<body>
  <section class="slide">
    <svg data-ark-id="ark-el-svg" style="left: 200px" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /></svg>
  </section>
</body>
</html>`

describe('applyDeckPatches element operations', () => {
  it('replaces text on a managed element', () => {
    const result = applyDeckPatches(arkManagedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-title',
        text: 'Updated opening',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.html).toContain('Updated opening')
    expect(result.changedSlideIndexes).toEqual([0])
    expect(result.changedElementIds).toContain('ark-el-title')
  })

  it('resolves path-based transient ids for nested managed elements', () => {
    const nestedDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Nested</title></head>
<body>
  <section class="slide">
    <div class="wrapper">
      <p data-ark-managed="true" style="position: absolute; left: 20px; top: 30px;">Nested copy</p>
    </div>
  </section>
</body>
</html>`
    const elementId = parseDeckHtml(nestedDeck).editableElements[0]?.elements.find(
      (element) => element.tagName === 'p' && element.textPreview === 'Nested copy',
    )?.id

    expect(elementId).toBe('transient-el-0-0.0')

    const result = applyDeckPatches(nestedDeck, [
      {
        op: 'replace_text',
        slideIndex: 0,
        elementId: elementId!,
        text: 'Updated nested copy',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.html).toContain('<p')
    expect(result.html).toContain('Updated nested copy</p>')
    expect(parseDeckHtml(result.html).editableElements[0]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: 'p',
          textPreview: 'Updated nested copy',
        }),
      ]),
    )
  })

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

  it('inserts text boxes and keeps slide parsing stable', () => {
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

    const parsed = parseDeckHtml(inserted.html)
    expect(parsed.slideCount).toBe(2)
    expect(inserted.html).toContain('ark-text-box')
    expect(inserted.html).toContain('data-ark-editable="text-box"')
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

  it('duplicates managed elements with a positional offset', () => {
    const duplicated = applyDeckPatches(arkManagedDeck, [
      {
        op: 'duplicate_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
      },
    ])

    expect(duplicated.ok).toBe(true)
    if (!duplicated.ok) {
      return
    }

    expect(duplicated.html.match(/Managed body copy/g)?.length).toBe(2)
    expect(duplicated.changedElementIds.some((id) => id.startsWith('ark-el-'))).toBe(true)
    // The source is absolutely positioned, so the clone keeps absolute layout and
    // is nudged by the default offset.
    expect(duplicated.html.match(/position: absolute/g)?.length).toBe(2)
    expect(duplicated.html).toContain('left: 74px')
    expect(duplicated.html).toContain('top: 134px')
  })

  it('duplicates flow-positioned elements without forcing absolute layout', () => {
    const duplicated = applyDeckPatches(arkManagedDeck, [
      {
        op: 'duplicate_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
      },
    ])

    expect(duplicated.ok).toBe(true)
    if (!duplicated.ok) {
      return
    }

    expect(duplicated.html.match(/Opening/g)?.length).toBe(2)
    // Only the pre-existing managed body copy stays absolutely positioned; the
    // flow-positioned heading clone must not be ripped out of flow or marked as
    // adopted layout.
    expect(duplicated.html.match(/position: absolute/g)?.length).toBe(1)
    expect(duplicated.html.match(/data-ark-managed="true"/g)?.length).toBe(1)
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

  it('adopts unmanaged elements on move and preserves their measured size', () => {
    const moved = applyDeckPatches(arkManagedDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
        x: 0.25,
        y: 0.1,
        width: 0.4,
        height: 0.15,
      },
    ])

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    expect(moved.html).toMatch(/data-ark-id="ark-el-title"[^>]*data-ark-managed="true"/)
    expect(moved.html).toMatch(/data-ark-id="ark-el-title"[^>]*position: absolute/)
    expect(moved.html).toContain(`width: ${Math.round(0.4 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(moved.html).toContain(`height: ${Math.round(0.15 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
    expect(moved.html).toContain('margin: 0')
    expect(moved.html).toContain('box-sizing: border-box')
  })

  it('inserts a flow spacer when adopting with a spacer payload', () => {
    const moved = applyDeckPatches(arkManagedDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
        x: 0.25,
        y: 0.1,
        width: 0.4,
        height: 0.15,
        spacer: {
          width: 512,
          height: 72,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 24,
          marginLeft: 0,
          display: 'block',
        },
      },
    ])

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    expect(moved.html).toContain('data-ark-spacer="true"')
    expect(moved.html).toContain('data-ark-spacer-for="ark-el-title"')
    expect(moved.html).toContain('width: 512px')
    expect(moved.html).toContain('height: 72px')
    expect(moved.html).toContain('margin: 0px 0px 24px 0px')
    expect(moved.html.indexOf('data-ark-spacer="true"')).toBeLessThan(
      moved.html.indexOf('data-ark-id="ark-el-title"'),
    )

    const parsed = parseDeckHtml(moved.html)
    expect(
      parsed.editableElements[0]?.elements.some(
        (element) => element.tagName === 'div' && !element.id,
      ),
    ).toBe(false)
    expect(
      parsed.editableElements
        .flatMap((group) => group.elements)
        .some((element) => element.id === 'ark-el-title'),
    ).toBe(true)

    const removed = applyDeckPatches(moved.html, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
        x: 0.3,
        y: 0.2,
        width: 0.4,
        spacer: {
          width: 512,
          height: 72,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 24,
          marginLeft: 0,
          display: 'block',
        },
      },
    ])

    expect(removed.ok).toBe(true)
    if (!removed.ok) {
      return
    }

    expect(removed.html.match(/data-ark-spacer="true"/g)?.length).toBe(1)
  })

  it('rejects adoption spacers as patch targets', () => {
    const withSpacer = applyDeckPatches(arkManagedDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
        x: 0.25,
        y: 0.1,
        width: 0.4,
        spacer: {
          width: 400,
          height: 80,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 0,
          marginLeft: 0,
          display: 'block',
        },
      },
    ])

    expect(withSpacer.ok).toBe(true)
    if (!withSpacer.ok) {
      return
    }

    const spacerDeck = withSpacer.html.replace(
      'data-ark-spacer="true"',
      'data-ark-id="ark-el-spacer" data-ark-spacer="true"',
    )
    const rejected = applyDeckPatches(spacerDeck, [
      {
        op: 'delete_element',
        slideIndex: 0,
        elementId: 'ark-el-spacer',
      },
    ])

    expect(rejected.ok).toBe(false)
    if (rejected.ok) {
      return
    }

    expect(rejected.error).toMatch(/not editable|not a recognized editable target/)
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

  it('deletes two transient sibling flow elements in one batch', () => {
    const siblingDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Siblings</title></head>
<body>
  <section class="slide">
    <h1>Opening</h1>
    <p>Body copy</p>
  </section>
</body>
</html>`
    const elements = parseDeckHtml(siblingDeck).editableElements[0]?.elements ?? []
    const headingId = elements.find((element) => element.tagName === 'h1')?.id
    const bodyId = elements.find((element) => element.tagName === 'p')?.id

    expect(headingId).toMatch(/^transient-el-/)
    expect(bodyId).toMatch(/^transient-el-/)
    expect(headingId).not.toBe(bodyId)

    const deleted = applyDeckPatches(siblingDeck, [
      { op: 'delete_element', slideIndex: 0, elementId: headingId! },
      { op: 'delete_element', slideIndex: 0, elementId: bodyId! },
    ])

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) {
      return
    }

    expect(deleted.html).not.toContain('Opening')
    expect(deleted.html).not.toContain('Body copy')
    expect(deleted.appliedCount).toBe(2)
  })

  it('adopts two transient sibling flow elements in one batched move', () => {
    const siblingDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Siblings</title></head>
<body>
  <section class="slide">
    <h1>Opening</h1>
    <p>Body copy</p>
  </section>
</body>
</html>`
    const elements = parseDeckHtml(siblingDeck).editableElements[0]?.elements ?? []
    const headingId = elements.find((element) => element.tagName === 'h1')?.id
    const bodyId = elements.find((element) => element.tagName === 'p')?.id

    expect(headingId).toMatch(/^transient-el-/)
    expect(bodyId).toMatch(/^transient-el-/)

    const spacer = {
      width: 400,
      height: 80,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      display: 'block',
    }
    const moved = applyDeckPatches(siblingDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: headingId!,
        x: 0.1,
        y: 0.1,
        width: 0.4,
        spacer,
      },
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: bodyId!,
        x: 0.1,
        y: 0.3,
        width: 0.4,
        spacer,
      },
    ])

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    expect(moved.appliedCount).toBe(2)
    expect(moved.html.match(/data-ark-managed="true"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(moved.html.match(/data-ark-spacer="true"/g)?.length).toBe(2)
    expect(moved.changedElementIds.filter((id) => id.startsWith('ark-el-'))).toHaveLength(2)
    expect(moved.html).toContain('Opening')
    expect(moved.html).toContain('Body copy')
  })

  it('rejects reordering a static inline SVG without changing its positioning', () => {
    const reordered = applyDeckPatches(inlineSvgDeck, [
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: 'ark-el-svg',
        direction: 'front',
      },
    ])

    expect(reordered).toEqual({
      ok: false,
      error: 'reorder_element requires a positioned element target.',
      operationIndex: 0,
    })
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

  it('uses the runtime logical slide size for Reveal transforms', () => {
    const moved = applyDeckPatches(arkManagedDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
        x: 0.25,
        y: 0.1,
        cssX: 0.25,
        cssY: 0.1,
        cssWidth: 0.4,
        width: 0.4,
        slideWidth: 960,
        slideHeight: 700,
      },
    ])

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    expect(moved.html).toContain('left: 240px')
    expect(moved.html).toContain('top: 70px')
    expect(moved.html).toContain('width: 384px')
  })

  it('preserves an adopted element parent and applies containing-block coordinates', () => {
    const moved = applyDeckPatches(
      `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Nested adoption</title></head>
<body>
  <section class="slide">
    <div style="position: relative; margin-left: 200px;">
      <h1 data-ark-id="ark-el-nested">Nested title</h1>
    </div>
  </section>
</body>
</html>`,
      [
        {
          op: 'move_element',
          slideIndex: 0,
          elementId: 'ark-el-nested',
          x: 0.25,
          y: 0.1,
          cssX: 0.09375,
          cssY: 0.1,
          cssWidth: 0.35,
          width: 0.4,
        },
      ],
    )

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    expect(moved.html.indexOf('data-ark-id="ark-el-nested"')).toBeLessThan(
      moved.html.indexOf('</div>'),
    )
    expect(moved.html).toContain(`left: ${Math.round(0.09375 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(moved.html).toContain(`top: ${Math.round(0.1 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
    expect(moved.html).toContain(`width: ${Math.round(0.35 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
  })

  it('uses containing-block coordinates for an already-absolute nested element', () => {
    const moved = applyDeckPatches(
      `<!DOCTYPE html><html lang="en"><head><title>Nested absolute</title></head><body>
        <section class="slide"><div style="position: relative; margin-left: 200px;">
          <h1 data-ark-id="ark-el-nested" style="position: absolute; left: 20px; top: 30px;">Title</h1>
        </div></section></body></html>`,
      [
        {
          op: 'move_element',
          slideIndex: 0,
          elementId: 'ark-el-nested',
          x: 0.25,
          y: 0.1,
          cssX: 0.09375,
          cssY: 0.1,
        },
      ],
    )

    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.html).toContain(`left: ${Math.round(0.09375 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(moved.html).toContain(`top: ${Math.round(0.1 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
  })

  it('reorders relative to siblings when given a direction', () => {
    const layeredDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Layered</title></head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-layers">
    <p data-ark-id="ark-el-a" data-ark-managed="true" data-ark-editable="true" style="position: absolute; left: 10px; top: 10px; z-index: 3;">A</p>
    <p data-ark-id="ark-el-b" data-ark-managed="true" data-ark-editable="true" style="position: absolute; left: 20px; top: 20px; z-index: 1;">B</p>
    <p data-ark-id="ark-el-c" data-ark-managed="true" data-ark-editable="true" style="position: absolute; left: 30px; top: 30px;">C</p>
  </section>
</body>
</html>`

    const front = applyDeckPatches(layeredDeck, [
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: 'ark-el-b',
        direction: 'front',
      },
    ])

    expect(front.ok).toBe(true)
    if (!front.ok) {
      return
    }

    // Siblings A (3) and C (auto → 0): front lands above the top sibling.
    expect(front.html).toMatch(/data-ark-id="ark-el-b"[^>]*z-index: 4/)

    const back = applyDeckPatches(layeredDeck, [
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: 'ark-el-a',
        direction: 'back',
      },
    ])

    expect(back.ok).toBe(true)
    if (!back.ok) {
      return
    }

    // Siblings B (1) and C (auto → 0): back floors at 0.
    expect(back.html).toMatch(/data-ark-id="ark-el-a"[^>]*z-index: 0/)
  })

  it('applies inline style updates and lock management', () => {
    const flowStyled = applyDeckPatches(arkManagedDeck, [
      {
        op: 'set_inline_style',
        slideIndex: 0,
        elementId: 'ark-el-title',
        style: { 'font-size': '32px' },
      },
    ])

    expect(flowStyled.ok).toBe(true)
    if (!flowStyled.ok) {
      return
    }

    expect(flowStyled.html).toMatch(/<h1[^>]*font-size: 32px/)
    expect(flowStyled.html).not.toMatch(/<h1[^>]*data-ark-managed/)

    const styled = applyDeckPatches(arkManagedDeck, [
      {
        op: 'set_inline_style',
        slideIndex: 0,
        elementId: 'ark-el-body',
        style: { color: 'rgb(10, 20, 30)', 'font-weight': '600' },
      },
    ])

    expect(styled.ok).toBe(true)
    if (!styled.ok) {
      return
    }

    expect(styled.html).toContain('color: rgb(10, 20, 30)')
    expect(styled.html).toContain('font-weight: 600')

    // Inspector typography controls rely on line-height being patchable (#84),
    // while non-whitelisted properties stay blocked.
    const lineHeight = applyDeckPatches(arkManagedDeck, [
      {
        op: 'set_inline_style',
        slideIndex: 0,
        elementId: 'ark-el-body',
        style: { 'line-height': '1.6' },
      },
    ])

    expect(lineHeight.ok).toBe(true)
    if (!lineHeight.ok) {
      return
    }

    expect(lineHeight.html).toContain('line-height: 1.6')

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'set_inline_style',
          slideIndex: 0,
          elementId: 'ark-el-body',
          style: { 'font-family': 'Comic Sans MS' },
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('does not allow') })

    const locked = applyDeckPatches(styled.html, [
      {
        op: 'lock_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
      },
    ])

    expect(locked.ok).toBe(true)
    if (!locked.ok) {
      return
    }

    expect(locked.html).toContain(`${ARK_LOCKED_ATTR}="true"`)

    const unlocked = applyDeckPatches(locked.html, [
      {
        op: 'unlock_element',
        slideIndex: 0,
        elementId: 'ark-el-locked',
      },
    ])

    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) {
      return
    }

    expect(unlocked.html).not.toContain('data-ark-id="ark-el-locked" data-ark-locked="true"')
  })

  it('rejects missing, ambiguous, locked, and unsafe targets', () => {
    expect(
      applyDeckPatches(arkManagedDeck, [
        { op: 'replace_text', elementId: 'ark-el-missing', text: 'Nope' },
      ]),
    ).toMatchObject({ ok: false })

    const duplicateIdDeck = arkManagedDeck.replace(
      '<h2 data-ark-id="ark-el-title-2"',
      '<h2 data-ark-id="ark-el-title"',
    )

    expect(
      applyDeckPatches(duplicateIdDeck, [
        { op: 'replace_text', elementId: 'ark-el-title', text: 'Ambiguous' },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('ambiguous') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'move_element',
          slideIndex: 0,
          elementId: 'ark-el-locked',
          x: 0.1,
          y: 0.1,
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('locked') })

    const notesId =
      parseDeckHtml(arkManagedDeck).editableElements[0]?.elements.find(
        (element) => element.lockReason === 'speaker-notes',
      )?.id ?? 'missing-notes'

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'move_element',
          slideIndex: 0,
          elementId: notesId,
          x: 0.1,
          y: 0.1,
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('not editable') })
  })

  it('rejects malformed ids, no-op patches, and unsafe attribute/style updates', () => {
    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'replace_text',
          slideIndex: 0,
          elementId: 'bad"\nselector',
          text: 'Nope',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('was not found') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'replace_text',
          slideIndex: 0,
          elementId: 'ark-el-title',
          text: 'Opening',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('did not change') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'set_attrs',
          slideIndex: 0,
          elementId: 'ark-el-title',
          attrs: { onclick: 'alert(1)' },
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('does not allow') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'set_attrs',
          slideIndex: 0,
          elementId: 'ark-el-title',
          attrs: { href: 'javascript:alert(1)' },
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('unsafe') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'set_inline_style',
          slideIndex: 0,
          elementId: 'ark-el-body',
          style: { left: '48px' },
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('did not change') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'insert_element',
          slideIndex: 0,
          html: '<div><script>alert(1)</script></div>',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('unsafe <script>') })

    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'insert_element',
          slideIndex: 0,
          html: '<p onclick="alert(1)">Unsafe handler</p>',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('onclick') })
  })

  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('inserts embedded data URL images and keeps validation passing', () => {
    const inserted = applyDeckPatches(arkManagedDeck, [
      {
        op: 'insert_element',
        slideIndex: 0,
        html: `<img data-ark-editable="image" data-ark-managed="true" alt="Logo" src="${tinyPngDataUrl}" style="position:absolute;left:128px;top:108px;width:512px;height:288px;object-fit:contain;z-index:1" />`,
      },
    ])

    expect(inserted.ok).toBe(true)
    if (!inserted.ok) {
      return
    }

    expect(inserted.html).toContain('data-ark-editable="image"')
    expect(inserted.html).toContain(tinyPngDataUrl)
  })

  it('rejects external image URLs on insert', () => {
    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'insert_element',
          slideIndex: 0,
          html: '<img data-ark-managed="true" src="https://example.com/photo.png" alt="" style="position:absolute;left:10px;top:10px;width:100px;height:100px;" />',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Remote image URLs') })
  })

  it('rejects external image URLs on set_attrs src', () => {
    const inserted = applyDeckPatches(arkManagedDeck, [
      {
        op: 'insert_element',
        slideIndex: 0,
        html: `<img data-ark-editable="image" data-ark-managed="true" alt="Logo" src="${tinyPngDataUrl}" style="position:absolute;left:128px;top:108px;width:512px;height:288px;object-fit:contain;z-index:1" />`,
      },
    ])

    expect(inserted.ok).toBe(true)
    if (!inserted.ok) {
      return
    }

    const image = inserted.changedElementIds.find((id) => id.startsWith('ark-el-'))
    expect(image).toBeTruthy()
    if (!image) {
      return
    }

    expect(
      applyDeckPatches(inserted.html, [
        {
          op: 'set_attrs',
          elementId: image,
          slideIndex: 0,
          attrs: { src: 'https://example.com/photo.png' },
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Remote image URLs') })
  })

  it('rejects external href URLs on set_attrs href', () => {
    expect(
      applyDeckPatches(arkManagedLinkDeck, [
        {
          op: 'set_attrs',
          elementId: 'ark-el-link',
          slideIndex: 0,
          attrs: { href: 'https://evil.example/phish' },
        },
      ]),
    ).toMatchObject({
      ok: false,
      operationIndex: 0,
      error: expect.stringContaining('external "href" URLs'),
    })
  })

  it('allows safe href values on set_attrs href', () => {
    const allowedHrefs = [
      { href: '/docs/guide', label: 'relative path' },
      { href: '#section', label: 'fragment' },
      {
        href: buildDeckAssetProxyUrl('https://example.com/logo.png'),
        label: 'asset proxy',
      },
    ]

    for (const { href } of allowedHrefs) {
      const result = applyDeckPatches(arkManagedLinkDeck, [
        {
          op: 'set_attrs',
          elementId: 'ark-el-link',
          slideIndex: 0,
          attrs: { href },
        },
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }

      expect(result.html).toContain(`href="${href}"`)
    }
  })

  it('rejects external href URLs on insert_element', () => {
    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'insert_element',
          slideIndex: 0,
          html: '<a data-ark-managed="true" href="https://evil.example/phish" style="position:absolute;left:48px;top:220px;">Phish</a>',
        },
      ]),
    ).toMatchObject({
      ok: false,
      operationIndex: 0,
      error: expect.stringContaining('unsafe "href"'),
    })
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
