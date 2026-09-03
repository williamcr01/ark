// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createElementId,
  parseEditableElement,
  parseEditableElementsForSlide,
  stampEditableElementIds,
} from './editable-elements.ts'
import { parseDeckDocument } from '../document/parser.ts'
import { validateDeckHtml } from '../validate/document.ts'

function parseDeckHtml(html: string) {
  return parseDeckDocument(new DOMParser().parseFromString(html, 'text/html'), html)
}

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures',
)

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const fullJsDeck = readFileSync(path.join(fixtureDir, 'full-js-deck.html'), 'utf8')
const hostileScriptsDeck = readFileSync(path.join(fixtureDir, 'hostile-scripts-deck.html'), 'utf8')

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
    <aside class="notes">Speaker only</aside>
  </section>
</body>
</html>`

describe('parseEditableElementsForSlide', () => {
  it('discovers Ark-managed elements with stable ids and layout metadata', () => {
    const parsed = parseDeckHtml(arkManagedDeck)
    const group = parsed.editableElements[0]

    expect(group).toMatchObject({
      slideIndex: 0,
      slideId: 'ark-slide-title',
      slideIdTransient: false,
    })

    const title = group?.elements.find((element) => element.id === 'ark-el-title')
    const body = group?.elements.find((element) => element.id === 'ark-el-body')

    expect(title).toMatchObject({
      idTransient: false,
      kind: 'text',
      role: 'title',
      managed: true,
      locked: false,
      lockReason: null,
      textPreview: 'Opening',
    })

    expect(body).toMatchObject({
      managed: true,
      locked: false,
      style: expect.objectContaining({
        position: 'absolute',
        left: 48,
        top: 120,
        width: 640,
        height: 80,
        zIndex: 2,
      }),
    })
  })

  it('marks speaker notes and explicit locks as non-editable', () => {
    const lockedDeck = arkManagedDeck.replace(
      '<aside class="notes">Speaker only</aside>',
      '<p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p><aside class="notes">Speaker only</aside>',
    )
    const group = parseDeckHtml(lockedDeck).editableElements[0]
    const locked = group?.elements.find((element) => element.id === 'ark-el-locked')
    const notes = group?.elements.find((element) => element.lockReason === 'speaker-notes')

    expect(locked).toMatchObject({
      locked: true,
      lockReason: 'explicit-lock',
    })
    expect(notes).toMatchObject({
      locked: true,
      lockReason: 'speaker-notes',
    })
  })

  it('classifies a resolved target without walking the rest of the slide', () => {
    const fragment = new DOMParser().parseFromString(arkManagedDeck, 'text/html')
    const slide = fragment.querySelector('section.slide')
    const body = fragment.querySelector('[data-ark-id="ark-el-body"]')
    const title = fragment.querySelector('[data-ark-id="ark-el-title"]')
    expect(slide).not.toBeNull()
    expect(body).not.toBeNull()
    expect(title).not.toBeNull()

    const group = parseEditableElementsForSlide(slide!, 0)
    const fromScan = group.elements.find((element) => element.id === 'ark-el-body')
    const fromTarget = parseEditableElement(body!, slide!, 0)

    expect(fromTarget).toMatchObject({
      id: 'ark-el-body',
      managed: true,
      locked: false,
      kind: 'text',
    })
    expect(fromTarget).toEqual(fromScan)
    expect(parseEditableElement(title!, slide!, 0)?.id).toBe('ark-el-title')
  })

  it('matches full-slide lock and unsafe classification for a resolved node', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Locks</title></head>
<body>
  <section class="slide">
    <p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p>
    <script data-ark-id="ark-el-script">alert(1)</script>
    <aside class="notes" data-ark-id="ark-el-notes">Speaker only</aside>
    <p data-ark-id="ark-el-body" data-ark-managed="true">Safe copy</p>
  </section>
</body>
</html>`
    const fragment = new DOMParser().parseFromString(html, 'text/html')
    const slide = fragment.querySelector('section.slide')
    expect(slide).not.toBeNull()

    const group = parseEditableElementsForSlide(slide!, 0)
    const locked = fragment.querySelector('[data-ark-id="ark-el-locked"]')
    const script = fragment.querySelector('[data-ark-id="ark-el-script"]')
    const notes = fragment.querySelector('[data-ark-id="ark-el-notes"]')
    expect(locked).not.toBeNull()
    expect(script).not.toBeNull()
    expect(notes).not.toBeNull()

    const fromScan = (id: string) => group.elements.find((element) => element.id === id)

    expect(parseEditableElement(locked!, slide!, 0)).toEqual(
      expect.objectContaining({
        id: 'ark-el-locked',
        locked: true,
        lockReason: 'explicit-lock',
      }),
    )
    expect(parseEditableElement(locked!, slide!, 0)).toEqual(fromScan('ark-el-locked'))
    expect(parseEditableElement(script!, slide!, 0)).toEqual(
      expect.objectContaining({
        id: 'ark-el-script',
        locked: true,
        lockReason: 'unsafe-tag',
      }),
    )
    expect(parseEditableElement(script!, slide!, 0)).toEqual(fromScan('ark-el-script'))
    expect(parseEditableElement(notes!, slide!, 0)).toEqual(
      expect.objectContaining({
        id: 'ark-el-notes',
        locked: true,
        lockReason: 'speaker-notes',
      }),
    )
    expect(parseEditableElement(notes!, slide!, 0)).toEqual(fromScan('ark-el-notes'))
  })
})

describe('parseEditableElements', () => {
  it('exposes best-effort text candidates for uploaded decks without metadata', () => {
    const parsed = parseDeckHtml(plainCssDeck)
    const firstSlide = parsed.editableElements[0]

    expect(parsed.slides[0]).toMatchObject({
      slideId: 'transient-slide-0',
      slideIdTransient: true,
    })

    expect(firstSlide?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'text',
          role: 'title',
          textPreview: 'Quarterly planning',
          idTransient: true,
          managed: false,
          locked: false,
          lockReason: null,
        }),
      ]),
    )
  })

  it('exposes containers alongside their editable descendants without stamping them', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><title>Containers</title></head>
<body>
  <section class="slide">
    <div class="card"><h2>Card title</h2><p>Card copy</p></div>
  </section>
</body>
</html>`
    const parsed = parseDeckHtml(html)
    const elements = parsed.editableElements[0]?.elements ?? []

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'container',
          tagName: 'div',
          idTransient: true,
          locked: false,
        }),
        expect.objectContaining({ kind: 'text', tagName: 'h2', textPreview: 'Card title' }),
        expect.objectContaining({ kind: 'text', tagName: 'p', textPreview: 'Card copy' }),
      ]),
    )

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const slide = doc.querySelector('section')!
    stampEditableElementIds(slide)
    expect(slide.querySelector('.card')?.hasAttribute('data-ark-id')).toBe(false)
  })

  it('stamps text-like elements that are also selectable containers', () => {
    const doc = new DOMParser().parseFromString(
      '<section><blockquote>Quote</blockquote><pre>Code</pre><a href="#">Link</a></section>',
      'text/html',
    )
    const slide = doc.querySelector('section')!

    stampEditableElementIds(slide)

    for (const tag of ['blockquote', 'pre', 'a']) {
      expect(slide.querySelector(tag)?.hasAttribute('data-ark-id')).toBe(true)
    }
  })

  it('handles inline svg image candidates without crashing', () => {
    const parsed = parseDeckHtml(`<!DOCTYPE html>
<html lang="en">
<head><title>SVG deck</title></head>
<body>
  <section class="slide">
    <h1>Inline artwork</h1>
    <svg class="logo-mark" viewBox="0 0 10 10" role="img" aria-label="Logo mark">
      <circle cx="5" cy="5" r="4"></circle>
    </svg>
  </section>
</body>
</html>`)

    expect(parsed.editableElements[0]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          tagName: 'svg',
          className: 'logo-mark',
          textPreview: 'Logo mark',
        }),
      ]),
    )
  })

  it('locks scripts, runtime controls, and hidden navigation elements', () => {
    const parsed = parseDeckHtml(hostileScriptsDeck)
    const scriptSlide = parsed.editableElements[1]

    expect(scriptSlide?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: 'script',
          locked: true,
          lockReason: 'unsafe-tag',
        }),
      ]),
    )

    const fullJs = parseDeckHtml(fullJsDeck)
    const deckLevel = fullJs.editableElements.find((group) => group.slideIndex === -1)

    expect(deckLevel?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: 'button',
          kind: 'runtime-control',
          locked: true,
          lockReason: 'runtime-control',
        }),
      ]),
    )
  })

  it('locks scripts and forms even when decks mark them as editable', () => {
    const hostileEditableDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Hostile editable</title></head>
<body>
  <section class="slide">
    <script data-ark-id="evil-script" data-ark-editable="true">alert(1)</script>
    <form data-ark-id="evil-form" data-ark-editable="true" data-ark-managed="true">
      <input name="token" />
    </form>
  </section>
</body>
</html>`
    const parsed = parseDeckHtml(hostileEditableDeck)
    const elements = parsed.editableElements[0]?.elements ?? []

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: 'script',
          locked: true,
          lockReason: 'unsafe-tag',
        }),
        expect.objectContaining({
          tagName: 'form',
          locked: true,
        }),
      ]),
    )
    expect(
      validateDeckHtml(hostileEditableDeck, (source) =>
        new DOMParser().parseFromString(source, 'text/html'),
      ).valid,
    ).toBe(false)
  })
})

describe('stampEditableElementIds', () => {
  it('assigns stable ids to newly inserted slide content', () => {
    const fragment = new DOMParser().parseFromString(
      '<section class="slide"><h2>New headline</h2><p>Details</p></section>',
      'text/html',
    )
    const slide = fragment.body.firstElementChild!

    const stamped = stampEditableElementIds(slide)

    expect(stamped).toHaveLength(2)
    expect(stamped.every((id) => id.startsWith('ark-el-'))).toBe(true)
    expect(slide.querySelector('h2')?.getAttribute('data-ark-id')).toBeTruthy()
    expect(slide.querySelector('p')?.getAttribute('data-ark-editable')).toBe('true')
  })

  it('does not overwrite existing ids', () => {
    const fragment = new DOMParser().parseFromString(
      '<section class="slide"><h1 data-ark-id="ark-el-existing">Keep me</h1></section>',
      'text/html',
    )
    const slide = fragment.body.firstElementChild!

    expect(stampEditableElementIds(slide)).toEqual([])
    expect(slide.querySelector('h1')?.getAttribute('data-ark-id')).toBe('ark-el-existing')
  })
})

describe('createElementId', () => {
  it('uses the Ark element id prefix', () => {
    expect(createElementId()).toMatch(/^ark-el-[A-Za-z0-9_-]{10}$/)
  })
})

describe('parseDeckHtml editableElements integration', () => {
  it('groups editable elements by slide without repeating slide outerHTML', () => {
    const parsed = parseDeckHtml(plainCssDeck)

    expect(parsed.editableElements).toHaveLength(3)
    expect(parsed.editableElements.every((group) => Array.isArray(group.elements))).toBe(true)
    expect(
      parsed.editableElements.every((group) =>
        group.elements.every((element) => !('outerHTML' in element)),
      ),
    ).toBe(true)
  })
})
