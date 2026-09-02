import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { parseDeckDocument } from '@ark/deck/document/parser.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck, inlineSvgDeck } from '@ark/deck/patch/element/test-decks.ts'

function parseDeckHtml(html: string) {
  return parseDeckDocument(new JSDOM(html).window.document, html)
}

describe('duplicate, delete, and reorder', () => {
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
})
