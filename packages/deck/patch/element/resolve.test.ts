import { describe, expect, it } from 'vitest'

import { parseDeckHtml } from '../../document/parser.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck } from './test-decks.ts'

describe('element target resolution', () => {
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

  it('rejects missing and ambiguous element ids', () => {
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
  })

  it('rejects malformed ids', () => {
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
  })
})
