// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

import {
  buildDeckCssNavRuntimeScript,
  createDeckPatchSlidesMessage,
  isDeckPatchSlidesResultMessage,
  isDeckSlideChangeMessage,
  type DeckSlidePatchOperation,
} from './index.ts'
import { createDeckSlideSnapshot, diffDeckSlideSnapshots } from './slide-patch.ts'
import { findSlideElements, SLIDE_SELECTOR_CHAIN } from './preview-slides.ts'

const inboundMessages: unknown[] = []

function collectMessage(event: MessageEvent) {
  inboundMessages.push(event.data)
}

/** Load a deck into the jsdom document and run the injected CSS-nav runtime. */
function mountCssNavDeck(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  document.head.innerHTML = doc.head.innerHTML
  document.body.innerHTML = doc.body.innerHTML
  inboundMessages.length = 0
  window.addEventListener('message', collectMessage)

  new Function(
    buildDeckCssNavRuntimeScript({
      slideSelectors: SLIDE_SELECTOR_CHAIN,
      previewMode: 'css-only',
    }),
  )()
}

/** jsdom's postMessage is async; let the queued dispatches run. */
async function flushMessages() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function slideTitles() {
  return findSlideElements(document).map((slide) => slide.textContent?.trim())
}

function activeSlideIndex() {
  return findSlideElements(document).findIndex((slide) => slide.hasAttribute('data-ark-active'))
}

async function applyPatch(operations: DeckSlidePatchOperation[], index: number) {
  inboundMessages.length = 0
  window.dispatchEvent(
    new MessageEvent('message', {
      data: createDeckPatchSlidesMessage('patch-1', operations, index),
      source: window,
    }),
  )
  await flushMessages()

  return inboundMessages.find(isDeckPatchSlidesResultMessage)
}

afterEach(() => {
  window.removeEventListener('message', collectMessage)
})

describe('CSS-nav slide patching', () => {
  it('replaces only the edited slide and stays on the active slide', async () => {
    const edited = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const patch = diffDeckSlideSnapshots(
      createDeckSlideSnapshot(plainCssDeck)!,
      createDeckSlideSnapshot(edited)!,
    )!

    mountCssNavDeck(plainCssDeck)
    await flushMessages()

    const untouchedSlide = findSlideElements(document)[2]
    const result = await applyPatch(patch.operations, 2)

    expect(result).toMatchObject({ applied: true, slideCount: 3 })
    expect(slideTitles()[1]).toContain('Metrics that mattered')
    // Slides the patch did not name keep their identity — no reparse, no reflow.
    expect(findSlideElements(document)[2]).toBe(untouchedSlide)
    expect(activeSlideIndex()).toBe(2)
    expect(inboundMessages.filter(isDeckSlideChangeMessage)).toContainEqual({
      type: 'ark:deck-slide-change',
      index: 2,
    })
  })

  it('appends a slide without disturbing the existing ones', async () => {
    const extended = plainCssDeck.replace(
      '</body>',
      '<section class="slide" data-title="Extra"><h2>One more thing</h2></section></body>',
    )
    const patch = diffDeckSlideSnapshots(
      createDeckSlideSnapshot(plainCssDeck)!,
      createDeckSlideSnapshot(extended)!,
    )!

    mountCssNavDeck(plainCssDeck)
    await flushMessages()

    const originals = findSlideElements(document)
    const result = await applyPatch(patch.operations, 1)

    expect(result).toMatchObject({ applied: true, slideCount: 4 })
    expect(findSlideElements(document).slice(0, 3)).toEqual(originals)
    expect(slideTitles()[3]).toContain('One more thing')
    expect(activeSlideIndex()).toBe(1)
  })

  it('removes a slide and clamps an active index that fell off the end', async () => {
    const trimmed = plainCssDeck.replace(
      /<section class="slide" data-title="Close">[\s\S]*?<\/section>/,
      '',
    )
    const patch = diffDeckSlideSnapshots(
      createDeckSlideSnapshot(plainCssDeck)!,
      createDeckSlideSnapshot(trimmed)!,
    )!

    mountCssNavDeck(plainCssDeck)
    await flushMessages()

    const result = await applyPatch(patch.operations, 2)

    expect(result).toMatchObject({ applied: true, slideCount: 2 })
    expect(activeSlideIndex()).toBe(1)
  })

  it('reports failure when an operation targets a slide that is not there', async () => {
    mountCssNavDeck(plainCssDeck)
    await flushMessages()

    const result = await applyPatch([{ op: 'remove', index: 9 }], 0)

    expect(result).toMatchObject({ applied: false })
    expect(findSlideElements(document)).toHaveLength(3)
  })
})
