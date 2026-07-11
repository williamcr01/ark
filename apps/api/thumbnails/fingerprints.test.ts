import { describe, expect, it } from 'vitest'

import { computeThumbnailSlideFingerprints } from './fingerprints.ts'

const baseHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Fingerprint Deck</title>
  <style>.slide { color: #111; }</style>
</head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`

const oneSlideEditedHtml = baseHtml.replace('<h1>Two</h1>', '<h1>Two edited</h1>')

describe('thumbnail slide fingerprints', () => {
  it('keeps unchanged slide fingerprints stable across a one-slide edit', () => {
    const first = computeThumbnailSlideFingerprints(baseHtml, 'manifest-a')
    const second = computeThumbnailSlideFingerprints(oneSlideEditedHtml, 'manifest-a')

    expect(first.slideFingerprints).toHaveLength(2)
    expect(second.slideFingerprints).toHaveLength(2)
    expect(second.slideFingerprints[0]).toBe(first.slideFingerprints[0])
    expect(second.slideFingerprints[1]).not.toBe(first.slideFingerprints[1])
  })

  it('changes all fingerprints when shared style state changes', () => {
    const first = computeThumbnailSlideFingerprints(baseHtml, 'manifest-a')
    const restyled = computeThumbnailSlideFingerprints(
      baseHtml.replace('color: #111', 'color: #222'),
      'manifest-a',
    )

    expect(restyled.slideFingerprints[0]).not.toBe(first.slideFingerprints[0])
    expect(restyled.slideFingerprints[1]).not.toBe(first.slideFingerprints[1])
  })

  it('includes the full deck hash for custom full-js decks', () => {
    const customJsHtml = baseHtml.replace(
      '<html lang="en">',
      '<html lang="en" data-ark-preview="full-js">',
    )
    const customJsEditedHtml = oneSlideEditedHtml.replace(
      '<html lang="en">',
      '<html lang="en" data-ark-preview="full-js">',
    )
    const first = computeThumbnailSlideFingerprints(customJsHtml, 'manifest-a')
    const second = computeThumbnailSlideFingerprints(customJsEditedHtml, 'manifest-a')

    expect(second.slideFingerprints[0]).not.toBe(first.slideFingerprints[0])
    expect(second.slideFingerprints[1]).not.toBe(first.slideFingerprints[1])
  })
})
