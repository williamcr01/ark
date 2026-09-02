import { describe, expect, it } from 'vitest'

import { parseDeckHtml } from '../../document/parser.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck } from './test-decks.ts'

describe('element patch validation', () => {
  it('rejects locked and unsafe targets', () => {
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
})
