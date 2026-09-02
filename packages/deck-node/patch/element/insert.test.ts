import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { ARK_MANAGED_ATTR } from '@ark/deck/document/metadata.ts'
import { parseDeckDocument } from '@ark/deck/document/parser.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck, tinyPngDataUrl } from '@ark/deck/patch/element/test-decks.ts'

function parseDeckHtml(html: string) {
  return parseDeckDocument(new JSDOM(html).window.document, html)
}

describe('insert_element', () => {
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
    expect(inserted.html).toContain(`${ARK_MANAGED_ATTR}="true"`)
  })

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

  it('rejects unsafe inserted elements and attributes', () => {
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
})
