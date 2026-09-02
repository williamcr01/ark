import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { applyDeckPatches } from '@ark/deck/patch/slide-ops.ts'
import { parseDeckHtml } from '@ark/deck-node/document/parser.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')

const hostileEditorPostmessageDeck = readFileSync(
  path.join(fixtureDir, 'hostile-editor-postmessage-deck.html'),
  'utf8',
)
const hostileFormsDeck = readFileSync(path.join(fixtureDir, 'hostile-forms-deck.html'), 'utf8')

describe('manual editor server security fixtures (#81)', () => {
  it('rejects server-side text patches forged against unknown element ids', () => {
    expect(
      applyDeckPatches(hostileEditorPostmessageDeck, [
        {
          op: 'replace_text',
          elementId: 'ark-el-locked-victim',
          slideIndex: 0,
          text: 'Injected copy',
        },
      ]),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('was not found'),
    })
  })

  it('rejects server-side delete patches forged against unknown element ids', () => {
    expect(
      applyDeckPatches(hostileEditorPostmessageDeck, [
        {
          op: 'delete_element',
          elementId: 'ark-el-locked-victim',
          slideIndex: 0,
        },
      ]),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('was not found'),
    })
  })

  it('rejects server-side delete patches that omit slideIndex for duplicate ids', () => {
    expect(
      applyDeckPatches(hostileEditorPostmessageDeck, [
        {
          op: 'delete_element',
          elementId: 'ark-el-title',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('ambiguous') })
  })

  it('rejects duplicate data-ark-id patch targets server-side', () => {
    expect(
      applyDeckPatches(hostileEditorPostmessageDeck, [
        {
          op: 'replace_text',
          elementId: 'ark-el-title',
          text: 'Ambiguous overwrite',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('ambiguous') })
  })

  it('marks forms as blocking validation errors and non-editable metadata', () => {
    const report = validateDeckHtmlOnServer(hostileFormsDeck)
    const parsed = parseDeckHtml(hostileFormsDeck)

    expect(report.valid).toBe(false)
    expect(report.forms).toBeGreaterThan(0)
    expect(parsed.editableElements.flatMap((group) => group.elements)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: 'form',
          locked: false,
        }),
      ]),
    )
  })
})
