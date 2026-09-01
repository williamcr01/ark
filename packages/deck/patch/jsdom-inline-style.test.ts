import { describe, expect, it } from 'vitest'

import { applyDeckPatches } from './slide-ops.ts'
import { createDeckJsdom } from './jsdom-inline-style.ts'

function styleAttribute(html: string, elementId: string) {
  const tag = html.match(new RegExp(`<[^>]*data-ark-id="${elementId}"[^>]*>`))?.[0]
  return tag?.match(/\sstyle="([^"]*)"/)?.[1] ?? null
}

function absoluteDeck(count: number) {
  const els = Array.from({ length: count }, (_, i) => {
    const left = 10 + (i % 20) * 40
    const top = 10 + Math.floor(i / 20) * 30
    return `<div data-ark-id="ark-el-${i}" data-ark-managed="true" style="position:absolute;left:${left}px;top:${top}px;width:80px;height:40px">Item ${i}</div>`
  }).join('\n')

  return `<!DOCTYPE html><html><head><title>Lazy style ${count}</title></head><body><section class="slide">${els}</section></body></html>`
}

describe('createDeckJsdom lazy inline styles', () => {
  it('keeps unread inline cssText as the original attribute until CSSOM is used', () => {
    const html = '<!DOCTYPE html><div id="x" style="position:absolute;left:10px;color:red">hi</div>'
    const dom = createDeckJsdom(html)
    const el = dom.window.document.getElementById('x')

    expect(el).not.toBeNull()
    if (!el) {
      return
    }

    expect(el.getAttribute('style')).toBe('position:absolute;left:10px;color:red')
    // Eager css-tree serialize adds spaces and a trailing semicolon.
    expect(el.style.cssText).toBe('position:absolute;left:10px;color:red')

    expect(dom.window.getComputedStyle(el).position).toBe('absolute')
    expect(el.style.left).toBe('10px')
    expect(el.style.cssText).toBe('position: absolute; left: 10px; color: red;')
  })

  it('still reports relative/sticky computed position after a deferred parse', () => {
    const html = '<!DOCTYPE html><div id="rel" style="position:relative;z-index:2">rel</div>'
    const dom = createDeckJsdom(html)
    const el = dom.window.document.getElementById('rel')

    expect(el).not.toBeNull()
    if (!el) {
      return
    }

    expect(dom.window.getComputedStyle(el).position).toBe('relative')
  })
})

describe('applyDeckPatches with deferred inline CSSOM', () => {
  it('moves one of 500 absolute elements without rewriting sibling style attributes', () => {
    const html = absoluteDeck(500)
    const siblingBefore = styleAttribute(html, 'ark-el-499')
    const movedBefore = styleAttribute(html, 'ark-el-0')
    const siblingLeft = 10 + (499 % 20) * 40
    const siblingTop = 10 + Math.floor(499 / 20) * 30

    expect(siblingBefore).toBe(
      `position:absolute;left:${siblingLeft}px;top:${siblingTop}px;width:80px;height:40px`,
    )

    const result = applyDeckPatches(html, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(styleAttribute(result.html, 'ark-el-499')).toBe(siblingBefore)
    expect(styleAttribute(result.html, 'ark-el-1')).toBe(styleAttribute(html, 'ark-el-1'))
    expect(styleAttribute(result.html, 'ark-el-0')).not.toBe(movedBefore)
    expect(styleAttribute(result.html, 'ark-el-0')).toContain('left: 640px')
    expect(result.validation?.valid).toBe(true)
    expect(result.changedElementIds).toEqual(['ark-el-0'])
  })

  it('reorders a relatively positioned element after flushing that target only', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Relative</title></head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-rel">
    <p data-ark-id="ark-el-a" data-ark-managed="true" data-ark-editable="true" style="position: relative; z-index: 1;">A</p>
    <p data-ark-id="ark-el-b" data-ark-managed="true" data-ark-editable="true" style="position: relative; z-index: 3;">B</p>
  </section>
</body>
</html>`

    const result = applyDeckPatches(html, [
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: 'ark-el-a',
        direction: 'front',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.html).toMatch(/data-ark-id="ark-el-a"[^>]*z-index: 4/)
    expect(styleAttribute(result.html, 'ark-el-b')).toBe('position: relative; z-index: 3;')
  })

  it('still collects url() in unread sibling inline styles during live validation', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>External style</title></head>
<body>
  <section class="slide">
    <div data-ark-id="ark-el-0" data-ark-managed="true" style="position:absolute;left:10px;top:10px;width:80px;height:40px">Move</div>
    <div data-ark-id="ark-el-1" data-ark-managed="true" style="background:url(https://evil.example/bg.png)">Stay</div>
  </section>
</body>
</html>`

    const result = applyDeckPatches(html, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.2, y: 0.2 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.validation?.valid).toBe(false)
    expect(result.validation?.externalUrls).toEqual(['https://evil.example/bg.png'])
    expect(styleAttribute(result.html, 'ark-el-1')).toBe(
      'background:url(https://evil.example/bg.png)',
    )
  })
})
