import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { applyDeckEdits } from './deck-edit.ts'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/test/fixtures',
)

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')

describe('applyDeckEdits', () => {
  it('applies multiple edits against the original HTML', () => {
    const titleMatch = plainCssDeck.match(/<h1[^>]*>[\s\S]*?<\/h1>/i)?.[0]

    expect(titleMatch).toBeTruthy()

    const result = applyDeckEdits(plainCssDeck, [
      {
        oldText: titleMatch!,
        newText: titleMatch!.replace(/>[\s\S]*?</, '>Updated title<'),
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.html).toContain('Updated title')
      expect(result.appliedCount).toBe(1)
    }
  })

  it('rejects edits when oldText is missing or ambiguous', () => {
    expect(applyDeckEdits(plainCssDeck, [])).toEqual({
      ok: false,
      error: 'At least one edit is required.',
    })

    expect(
      applyDeckEdits(plainCssDeck, [{ oldText: 'missing text', newText: 'x' }]),
    ).toMatchObject({ ok: false })

    expect(
      applyDeckEdits(plainCssDeck, [{ oldText: 'section', newText: 'article' }]),
    ).toMatchObject({ ok: false })
  })

  it('applies disjoint edits using original match positions', () => {
    const result = applyDeckEdits('hello world', [
      { oldText: 'hello', newText: 'hi' },
      { oldText: 'world', newText: 'earth' },
    ])

    expect(result).toEqual({ ok: true, html: 'hi earth', appliedCount: 2 })
  })

  it('rejects overlapping edits that would silently no-op', () => {
    expect(
      applyDeckEdits('abc', [
        { oldText: 'abc', newText: 'a' },
        { oldText: 'b', newText: 'B' },
      ]),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('overlap'),
    })
  })
})
