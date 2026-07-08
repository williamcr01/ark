import { describe, expect, it } from 'vitest'

import { computeDeckVersionDiff } from './deck-diff.ts'

const baseDeck = (slides: string[], title = 'Deck') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
${slides.join('\n')}
</body>
</html>`

describe('computeDeckVersionDiff', () => {
  it('detects added and deleted slides', () => {
    const before = baseDeck([
      '<section class="slide" data-ark-slide-id="s1"><h1>One</h1></section>',
      '<section class="slide" data-ark-slide-id="s2"><h1>Two</h1></section>',
    ])
    const after = baseDeck([
      '<section class="slide" data-ark-slide-id="s1"><h1>One</h1></section>',
      '<section class="slide" data-ark-slide-id="s3"><h1>Three</h1></section>',
    ])

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.kind).toBe('structural')
    expect(diff.slideCountBefore).toBe(2)
    expect(diff.slideCountAfter).toBe(2)
    expect(diff.deletedSlides).toEqual([{ index: 1, title: 'Two' }])
    expect(diff.addedSlides).toEqual([{ index: 1, title: 'Three' }])
  })

  it('detects moved slides by stable slide id', () => {
    const before = baseDeck([
      '<section class="slide" data-ark-slide-id="s1"><h1>One</h1></section>',
      '<section class="slide" data-ark-slide-id="s2"><h1>Two</h1></section>',
    ])
    const after = baseDeck([
      '<section class="slide" data-ark-slide-id="s2"><h1>Two</h1></section>',
      '<section class="slide" data-ark-slide-id="s1"><h1>One</h1></section>',
    ])

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.movedSlides).toEqual([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 0 },
    ])
  })

  it('detects title, notes, and content changes', () => {
    const before = baseDeck([
      `<section class="slide" data-ark-slide-id="s1">
        <h1>Opening</h1>
        <aside class="notes">Old note</aside>
      </section>`,
    ])
    const after = baseDeck([
      `<section class="slide" data-ark-slide-id="s1">
        <h1>Renamed</h1>
        <p>More content</p>
        <aside class="notes">New note</aside>
      </section>`,
    ])

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.changedSlides).toEqual([
      {
        index: 0,
        title: 'Renamed',
        titleChanged: true,
        notesChanged: true,
        contentChanged: true,
      },
    ])
  })

  it('matches transient slide ids by title fallback', () => {
    const before = baseDeck(['<section class="slide"><h1>Agenda</h1></section>'])
    const after = baseDeck(['<section class="slide"><h1>Agenda</h1><p>Updated</p></section>'])

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.changedSlides).toEqual([
      {
        index: 0,
        title: 'Agenda',
        contentChanged: true,
      },
    ])
  })

  it('detects deck title and asset changes without storing raw data URIs', () => {
    const before = baseDeck(
      ['<section class="slide"><h1>Slide</h1><img src="data:image/png;base64,abc" /></section>'],
      'Before',
    )
    const after = baseDeck(
      ['<section class="slide"><h1>Slide</h1><img src="data:image/png;base64,def" /></section>'],
      'After',
    )

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.titleChanged).toBe(true)
    expect(diff.assetsAdded).toEqual([
      expect.stringMatching(/^data-asset:data:image\/png;base64;len=\d+;fp=[0-9a-f]+$/),
    ])
    expect(diff.assetsRemoved).toEqual([
      expect.stringMatching(/^data-asset:data:image\/png;base64;len=\d+;fp=[0-9a-f]+$/),
    ])
    expect(JSON.stringify(diff)).not.toContain('base64,abc')
    expect(JSON.stringify(diff)).not.toContain('base64,def')
  })

  it('keeps structural diffs when assets are large data URIs', () => {
    const huge = 'A'.repeat(5000)
    const before = baseDeck([
      `<section class="slide"><h1>Slide</h1><img src="data:image/png;base64,${huge}" /></section>`,
    ])
    const after = baseDeck([
      `<section class="slide"><h1>Slide</h1><img src="data:image/png;base64,${huge}B" /></section>`,
    ])

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.kind).toBe('structural')
    expect(diff.assetsAdded?.[0]?.length).toBeLessThanOrEqual(2048)
    expect(diff.assetsRemoved?.[0]?.length).toBeLessThanOrEqual(2048)
    expect(JSON.stringify(diff)).not.toContain(huge)
  })

  it('matches duplicate stable slide ids without dropping slides', () => {
    const before = baseDeck([
      '<section class="slide" data-ark-slide-id="dup"><h1>One</h1></section>',
      '<section class="slide" data-ark-slide-id="dup"><h1>Two</h1></section>',
    ])
    const after = baseDeck([
      '<section class="slide" data-ark-slide-id="dup"><h1>One changed</h1></section>',
      '<section class="slide" data-ark-slide-id="dup"><h1>Two changed</h1></section>',
    ])

    const diff = computeDeckVersionDiff(before, after)

    expect(diff.kind).toBe('structural')
    expect(diff.changedSlides).toHaveLength(2)
    expect(diff.addedSlides).toEqual([])
    expect(diff.deletedSlides).toEqual([])
  })

  it('falls back to coarse diff for malformed HTML', () => {
    const diff = computeDeckVersionDiff('not html', '<html><body></body></html>')

    expect(diff).toEqual({
      kind: 'coarse',
      htmlBytesBefore: expect.any(Number),
      htmlBytesAfter: expect.any(Number),
    })
  })
})
