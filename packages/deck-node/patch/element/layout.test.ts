import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import { parseDeckDocument } from '@ark/deck/document/parser.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck } from '@ark/deck/patch/element/test-decks.ts'

function parseDeckHtml(html: string) {
  return parseDeckDocument(new JSDOM(html).window.document, html)
}

describe('move_element and resize_element', () => {
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

  it('moves one managed element on a 500-element slide without rewriting siblings', () => {
    const elements = Array.from({ length: 500 }, (_, index) => {
      const left = 10 + (index % 20) * 40
      const top = 10 + Math.floor(index / 20) * 30
      return `<div data-ark-id="ark-el-${index}" data-ark-managed="true" style="position:absolute;left:${left}px;top:${top}px;width:80px;height:40px">Item ${index}</div>`
    }).join('\n')
    const html = `<!DOCTYPE html><html><head><title>Dense</title></head><body><section class="slide">${elements}</section></body></html>`

    const result = applyDeckPatches(html, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.html).toContain(`left: ${Math.round(0.5 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(result.html).toContain(`top: ${Math.round(0.5 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
    expect(result.html).toContain('data-ark-id="ark-el-499"')
    expect(result.html.match(/data-ark-id="ark-el-\d+"/g)).toHaveLength(500)
    expect(result.changedElementIds).toEqual(['ark-el-0'])
  })
})
