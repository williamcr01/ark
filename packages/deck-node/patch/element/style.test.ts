import { describe, expect, it } from 'vitest'

import { buildDeckAssetProxyUrl } from '@ark/deck/document/network.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import {
  arkManagedDeck,
  arkManagedLinkDeck,
  tinyPngDataUrl,
} from '@ark/deck/patch/element/test-decks.ts'

describe('set_attrs and set_inline_style', () => {
  it('applies inline style updates on flow and managed elements', () => {
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
  })

  it('rejects no-op and unsafe attribute or style updates', () => {
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
})
