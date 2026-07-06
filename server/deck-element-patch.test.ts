import { describe, expect, it } from 'vitest'

import {
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '../shared/deck-metadata.ts'
import { applyDeckPatches } from './deck-patch.ts'
import { parseDeckHtml } from './deck-parser.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'

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

function expectValidDeck(html: string) {
  const validation = validateDeckHtmlOnServer(html)
  expect(validation.valid).toBe(true)
  return validation
}

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

    expectValidDeck(result.html)
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
      (element) => element.textPreview === 'Nested copy',
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

    expectValidDeck(inserted.html)
    const parsed = parseDeckHtml(inserted.html)
    expect(parsed.slideCount).toBe(2)
    expect(inserted.html).toContain('ark-text-box')
    expect(inserted.html).toContain('data-ark-editable="text-box"')
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
  })

  it('moves, resizes, and reorders managed elements using normalized geometry', () => {
    const moved = applyDeckPatches(arkManagedDeck, [
      {
        op: 'move_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
        x: 0.1,
        y: 0.2,
      },
    ])

    expect(moved.ok).toBe(true)
    if (!moved.ok) {
      return
    }

    const expectedLeft = `${Math.round(0.1 * ARK_SLIDE_REFERENCE_WIDTH)}px`
    const expectedTop = `${Math.round(0.2 * ARK_SLIDE_REFERENCE_HEIGHT)}px`
    expect(moved.html).toContain(`left: ${expectedLeft}`)
    expect(moved.html).toContain(`top: ${expectedTop}`)

    const resized = applyDeckPatches(moved.html, [
      {
        op: 'resize_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
        width: 0.5,
        height: 0.25,
      },
    ])

    expect(resized.ok).toBe(true)
    if (!resized.ok) {
      return
    }

    const expectedWidth = `${Math.round(0.5 * ARK_SLIDE_REFERENCE_WIDTH)}px`
    const expectedHeight = `${Math.round(0.25 * ARK_SLIDE_REFERENCE_HEIGHT)}px`
    expect(resized.html).toContain(`width: ${expectedWidth}`)
    expect(resized.html).toContain(`height: ${expectedHeight}`)

    const reordered = applyDeckPatches(resized.html, [
      {
        op: 'reorder_element',
        slideIndex: 0,
        elementId: 'ark-el-body',
        zIndex: 5,
      },
    ])

    expect(reordered.ok).toBe(true)
    if (!reordered.ok) {
      return
    }

    expect(reordered.html).toContain('z-index: 5')
  })

  it('applies inline style updates and lock management', () => {
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
          op: 'replace_text',
          slideIndex: 0,
          elementId: 'ark-el-locked',
          text: 'Still locked',
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
          op: 'delete_element',
          slideIndex: 0,
          elementId: notesId,
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
