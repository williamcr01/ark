/** @vitest-environment jsdom */

import './install-test-constants.ts'
import { describe, expect, it } from 'vitest'

import { isNestedInSelection, toggleSelectedElement } from './chrome.ts'
import { isUnsafeTag } from './selection.ts'
import { runtime } from './state.ts'

describe('selection helpers', () => {
  it('rejects unsafe tags', () => {
    expect(isUnsafeTag('script')).toBe(true)
    expect(isUnsafeTag('textarea')).toBe(true)
    expect(isUnsafeTag('div')).toBe(false)
  })

  it('detects nested members in the current selection set', () => {
    document.body.innerHTML =
      '<section class="slide"><div id="outer"><p id="inner">Hi</p></div></section>'
    const outer = document.querySelector<HTMLElement>('#outer')!
    const inner = document.querySelector<HTMLElement>('#inner')!
    runtime.selectedElements = [outer, inner]
    expect(isNestedInSelection(inner)).toBe(true)
    expect(isNestedInSelection(outer)).toBe(true)
    runtime.selectedElements = [outer]
    expect(isNestedInSelection(inner)).toBe(true)
    expect(isNestedInSelection(outer)).toBe(false)
    runtime.selectedElements = []
  })

  it('caps additive selection at MAX_SELECTIONS', () => {
    const slide = document.createElement('section')
    slide.className = 'slide'
    document.body.appendChild(slide)
    const nodes = Array.from({ length: 33 }, (_, index) => {
      const node = document.createElement('p')
      node.textContent = String(index)
      slide.appendChild(node)
      return node
    })

    runtime.selectedElements = []
    runtime.selectedElement = null
    for (const node of nodes) {
      toggleSelectedElement(node, slide, 0)
    }

    expect(runtime.selectedElements).toHaveLength(32)
    expect(runtime.selectedElements.includes(nodes[32]!)).toBe(false)
    runtime.selectedElements = []
    runtime.selectedElement = null
    slide.remove()
  })
})
