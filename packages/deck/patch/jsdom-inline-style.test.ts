import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'

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
    const compact = 'position:absolute;left:10px;color:red'
    const html = `<!DOCTYPE html><div id="x" style="${compact}">hi</div>`
    const dom = createDeckJsdom(html)
    const el = dom.window.document.getElementById('x')

    expect(el).not.toBeNull()
    if (!el) {
      return
    }

    expect(el.getAttribute('style')).toBe(compact)
    expect(dom.serialize()).toContain(`style="${compact}"`)

    expect(el.style.left).toBe('10px')
    expect(dom.window.getComputedStyle(el).position).toBe('absolute')
    // CSSOM reads flush css-tree, but must not rewrite the attribute.
    expect(el.getAttribute('style')).toBe(compact)
    expect(dom.serialize()).toContain(`style="${compact}"`)
    expect(el.style.cssText).toBe('position: absolute; left: 10px; color: red;')
    expect(el.getAttribute('style')).toBe(compact)

    el.style.setProperty('top', '20px')
    expect(el.style.top).toBe('20px')
    expect(el.style.cssText).toBe('position: absolute; left: 10px; color: red; top: 20px;')
  })

  it('applies named CSSOM writes on an unread lazy element', () => {
    const compact = 'position:absolute;left:10px;top:20px'
    const html = `<!DOCTYPE html><div id="a" style="${compact}">x</div>`
    const dom = createDeckJsdom(html)
    const el = dom.window.document.getElementById('a')

    expect(el).not.toBeNull()
    if (!el) {
      return
    }

    el.style.left = '999px'
    expect(el.style.left).toBe('999px')
    expect(el.getAttribute('style')).toContain('left: 999px')
    expect(el.getAttribute('style')).toContain('top: 20px')
  })

  it('exposes indexed style properties after a deferred parse', () => {
    const html = `<!DOCTYPE html><div id="b" style="left:1px">y</div>`
    const dom = createDeckJsdom(html)
    const el = dom.window.document.getElementById('b')

    expect(el).not.toBeNull()
    if (!el) {
      return
    }

    expect(el.style[0]).toBe('left')
    expect(el.style.length).toBe(1)
    expect(el.style.getPropertyValue('left')).toBe('1px')
    expect(el.getAttribute('style')).toBe('left:1px')
  })

  it('does not leak lazy parsing into later eager JSDOM documents', () => {
    createDeckJsdom('<!DOCTYPE html><div style="left:1px">warmup</div>')

    const html = `<!DOCTYPE html><div id="x" style="position:absolute;left:10px;top:20px">x</div>`
    const eager = new JSDOM(html)
    const el = eager.window.document.getElementById('x')

    expect(el).not.toBeNull()
    if (!el) {
      return
    }

    expect(el.style[0]).toBe('position')
    el.style.left = '999px'
    expect(el.style.left).toBe('999px')
    expect(el.getAttribute('style')).toContain('left: 999px')
  })

  it('still reports relative/sticky computed position after a deferred parse', () => {
    const html =
      '<!DOCTYPE html><div id="rel" style="position:relative;z-index:2">rel</div><div id="stk" style="position:sticky;top:0">stk</div>'
    const dom = createDeckJsdom(html)
    const rel = dom.window.document.getElementById('rel')
    const sticky = dom.window.document.getElementById('stk')

    expect(rel).not.toBeNull()
    expect(sticky).not.toBeNull()
    if (!rel || !sticky) {
      return
    }

    expect(dom.window.getComputedStyle(rel).position).toBe('relative')
    expect(dom.window.getComputedStyle(sticky).position).toBe('sticky')
  })
})

describe('applyDeckPatches with deferred inline CSSOM', () => {
  it('moves and resizes one of 500 absolute elements without rewriting sibling style attributes', () => {
    const html = absoluteDeck(500)
    const siblingBefore = styleAttribute(html, 'ark-el-499')
    const movedBefore = styleAttribute(html, 'ark-el-0')
    const siblingLeft = 10 + (499 % 20) * 40
    const siblingTop = 10 + Math.floor(499 / 20) * 30
    const expectedWidth = `${Math.round(0.2 * ARK_SLIDE_REFERENCE_WIDTH)}px`
    const expectedHeight = `${Math.round(0.1 * ARK_SLIDE_REFERENCE_HEIGHT)}px`

    expect(siblingBefore).toBe(
      `position:absolute;left:${siblingLeft}px;top:${siblingTop}px;width:80px;height:40px`,
    )

    const result = applyDeckPatches(html, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
      { op: 'resize_element', elementId: 'ark-el-0', slideIndex: 0, width: 0.2, height: 0.1 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(styleAttribute(result.html, 'ark-el-499')).toBe(siblingBefore)
    expect(styleAttribute(result.html, 'ark-el-1')).toBe(styleAttribute(html, 'ark-el-1'))
    expect(styleAttribute(result.html, 'ark-el-0')).not.toBe(movedBefore)
    expect(styleAttribute(result.html, 'ark-el-0')).toContain('left: 640px')
    expect(styleAttribute(result.html, 'ark-el-0')).toContain(`width: ${expectedWidth}`)
    expect(styleAttribute(result.html, 'ark-el-0')).toContain(`height: ${expectedHeight}`)
    expect(result.validation?.valid).toBe(true)
    expect(result.changedElementIds).toEqual(['ark-el-0'])
  })

  it('inserts a compact-style fragment without rewriting unread sibling styles', () => {
    const html = absoluteDeck(2)
    const compact = 'position:absolute;left:12px;top:24px;width:90px;height:50px'

    const result = applyDeckPatches(html, [
      {
        op: 'insert_element',
        slideIndex: 0,
        html: `<div data-ark-id="ark-el-ins" style="${compact}">New</div>`,
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(styleAttribute(result.html, 'ark-el-ins')).toBe(compact)
    expect(styleAttribute(result.html, 'ark-el-0')).toBe(styleAttribute(html, 'ark-el-0'))
    expect(styleAttribute(result.html, 'ark-el-1')).toBe(styleAttribute(html, 'ark-el-1'))
  })

  it('parses an add_slide fragment without rewriting unread compact styles', () => {
    const html = absoluteDeck(1)
    const compact = 'position:absolute;left:8px;top:9px;width:70px;height:30px'

    const result = applyDeckPatches(html, [
      {
        op: 'add_slide',
        afterIndex: 0,
        html: `<section class="slide"><div data-ark-id="ark-el-new" data-ark-managed="true" style="${compact}">New slide</div></section>`,
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(styleAttribute(result.html, 'ark-el-new')).toBe(compact)
    expect(styleAttribute(result.html, 'ark-el-0')).toBe(styleAttribute(html, 'ark-el-0'))
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
