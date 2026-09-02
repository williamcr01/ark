// @ts-expect-error this package does not depend on @types/jsdom
import { JSDOM as JsdomImport } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_HANDSHAKE_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
} from '../index.ts'

type JsdomWindow = Window & typeof globalThis
type JsdomInstance = { window: JsdomWindow; serialize: () => string }
const JSDOM = JsdomImport as new (
  html?: string,
  options?: {
    pretendToBeVisual?: boolean
    runScripts?: 'dangerously' | 'outside-only'
    url?: string
    beforeParse?: (window: JsdomWindow) => void
  },
) => JsdomInstance

type RuntimeMessage = Record<string, unknown>

function waitForLoad(dom: JsdomInstance) {
  return new Promise<void>((resolve) => {
    dom.window.addEventListener('load', () => resolve())
  })
}

function flush(dom: JsdomInstance) {
  return new Promise<void>((resolve) => {
    dom.window.setTimeout(() => resolve(), 0)
  })
}

function captureParentMessages(window: JsdomWindow, messages: RuntimeMessage[]) {
  const original = window.postMessage.bind(window)
  window.postMessage = ((message: unknown, targetOrigin?: string, transfer?: Transferable[]) => {
    messages.push(message as RuntimeMessage)
    return original(message as RuntimeMessage, targetOrigin ?? '*', transfer)
  }) as typeof window.postMessage
}

describe('deck handshake sentinel', () => {
  it('posts the handshake sentinel to a distinct parent and removes its script', async () => {
    const messages: RuntimeMessage[] = []
    const script = buildDeckHandshakeSentinelScript('hs-abc', 'https://ark.test')
    expect(script).toContain('ark:deck-handshake')
    expect(script).toContain('hs-abc')
    expect(script).toContain('safeSetTimeout(postHandshake')
    expect(script).not.toContain('eval(')
    expect(script).not.toContain('new Function')

    const dom = new JSDOM(
      `<!doctype html><html><head></head><body><script>${script}</script></body></html>`,
      {
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        url: 'https://ark.test/preview',
        beforeParse(window) {
          const nativeSetTimeout = window.setTimeout.bind(window) as typeof window.setTimeout
          window.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) =>
            nativeSetTimeout(handler, 0, ...args)) as typeof window.setTimeout
          Object.defineProperty(window, 'parent', {
            configurable: true,
            value: {
              postMessage: (message: RuntimeMessage) => {
                messages.push(message)
              },
            },
          })
        },
      },
    )

    await waitForLoad(dom)
    await flush(dom)

    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0]).toEqual({
      type: DECK_HANDSHAKE_MESSAGE_TYPE,
      handshake: 'hs-abc',
      protocolVersion: 1,
    })
    expect(dom.window.document.querySelector('script')).toBeNull()
    expect(
      buildDeckHandshakeSentinelScript('hs-abc', 'https://ark.test', '__arkEditorSessionV1'),
    ).toContain('__arkEditorSessionV1')
    expect(buildDeckHandshakeSentinelScript('hs-abc', null, '  ')).toContain(
      '"EDITOR_SESSION_HANDOFF_KEY":""',
    )
    dom.window.close()
  })

  it('stamps the editor session handoff key when provided', async () => {
    const script = buildDeckHandshakeSentinelScript(
      'hs-session',
      'https://ark.test',
      '__arkEditorSessionV1',
    )
    const dom = new JSDOM(`<!doctype html><body><script>${script}</script></body>`, {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'https://ark.test/preview',
      beforeParse(window) {
        Object.defineProperty(window, 'parent', {
          configurable: true,
          value: { postMessage: () => undefined },
        })
      },
    })

    await waitForLoad(dom)
    expect((dom.window as unknown as Record<string, string>).__arkEditorSessionV1).toBe(
      'hs-session',
    )
    dom.window.close()
  })
})

describe('CSS-only nav shim', () => {
  it('responds to ark:deck-goto and emits slide-change', async () => {
    const messages: RuntimeMessage[] = []
    const script = buildDeckCssNavRuntimeScript({
      slideSelectors: ['section.slide'],
      previewMode: 'css-only',
    })
    expect(script).toContain('isTypingTarget')
    expect(script).toContain('data-ark-editor-text-edit')
    expect(script).toContain('data-ark-editor-selected')

    const dom = new JSDOM(
      `<!doctype html><body>
        <section class="slide">One</section>
        <section class="slide">Two</section>
        <script>${script}</script>
      </body>`,
      {
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        url: 'https://ark.test/preview',
        beforeParse(window) {
          captureParentMessages(window, messages)
        },
      },
    )

    await waitForLoad(dom)
    await flush(dom)

    const slides = [...dom.window.document.querySelectorAll('section.slide')]
    expect(slides[0]?.hasAttribute('data-ark-active')).toBe(true)
    expect(messages.some((message) => message.type === DECK_READY_MESSAGE_TYPE)).toBe(true)

    messages.length = 0
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
        source: dom.window,
        origin: 'https://ark.test',
      }),
    )
    await flush(dom)

    expect(slides[1]?.hasAttribute('data-ark-active')).toBe(true)
    expect(messages).toContainEqual({ type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index: 1 })
    dom.window.close()
  })

  it('ignores arrow keys while inline text editing', async () => {
    const script = buildDeckCssNavRuntimeScript({
      slideSelectors: ['section.slide'],
      previewMode: 'css-only',
    })
    const dom = new JSDOM(
      `<!doctype html><body>
        <section class="slide"><h1 contenteditable="true">One</h1></section>
        <section class="slide">Two</section>
        <script>${script}</script>
      </body>`,
      { pretendToBeVisual: true, runScripts: 'dangerously', url: 'https://ark.test/preview' },
    )

    await waitForLoad(dom)
    const heading = dom.window.document.querySelector('h1')!
    heading.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    expect(
      dom.window.document.querySelectorAll('section.slide')[0]?.hasAttribute('data-ark-active'),
    ).toBe(true)

    heading.removeAttribute('contenteditable')
    heading.setAttribute('data-ark-editor-selected', 'primary')
    heading.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    expect(
      dom.window.document.querySelectorAll('section.slide')[0]?.hasAttribute('data-ark-active'),
    ).toBe(true)
    dom.window.close()
  })
})

describe('custom-deck bridge', () => {
  it('forwards parent goto as a CustomEvent and slide-change back to the parent', async () => {
    const messages: RuntimeMessage[] = []
    const gotoIndexes: number[] = []
    const script = buildDeckBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
      previewMode: 'full-js',
    })

    const dom = new JSDOM(
      `<!doctype html><html><body>
        <section class="slide">One</section>
        <section class="slide">Two</section>
        <script>${script}</script>
      </body></html>`,
      {
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        url: 'https://ark.test/preview',
        beforeParse(window) {
          captureParentMessages(window, messages)
        },
      },
    )

    await waitForLoad(dom)
    dom.window.document.addEventListener(DECK_GOTO_MESSAGE_TYPE, (event) => {
      gotoIndexes.push((event as CustomEvent<{ index: number }>).detail.index)
    })

    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
        source: dom.window,
        origin: 'https://ark.test',
      }),
    )
    expect(gotoIndexes).toEqual([1])

    messages.length = 0
    dom.window.document.dispatchEvent(
      new dom.window.CustomEvent(DECK_SLIDE_CHANGE_MESSAGE_TYPE, { detail: { index: 1 } }),
    )
    await flush(dom)
    expect(messages).toContainEqual({ type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index: 1 })

    messages.length = 0
    dom.window.document.dispatchEvent(
      new dom.window.CustomEvent(DECK_METADATA_MESSAGE_TYPE, {
        detail: { metadata: { runtime: 'plain', title: 'From deck', previewMode: 'full-js' } },
      }),
    )
    await flush(dom)
    expect(messages).toContainEqual({
      type: DECK_METADATA_MESSAGE_TYPE,
      metadata: {
        runtime: 'plain',
        title: 'From deck',
        previewMode: 'full-js',
        protocolVersion: 1,
      },
    })
    dom.window.close()
  })
})

describe('Reveal adapter', () => {
  it('preserves Reveal deck dimensions and dispatches ark:deck-slide-change CustomEvents', async () => {
    const script = buildRevealNavRuntimeScript({
      slideSelectors: ['.reveal .slides > section'],
      previewMode: 'full-js',
    })
    expect(script).not.toContain('width: C.SLIDE_WIDTH')
    expect(script).not.toContain('height: C.SLIDE_HEIGHT')
    expect(script).toContain('new CustomEvent(C.CHANGE')
    expect(script).toContain('detail: { index: clamped }')

    const messages: RuntimeMessage[] = []
    const customEvents: number[] = []
    let current = 0
    const revealHooks: { slideChanged: (() => void) | null } = { slideChanged: null }

    const dom = new JSDOM(
      `<!doctype html><body>
        <div class="reveal"><div class="slides">
          <section>One</section>
          <section>Two</section>
        </div></div>
        <script>${script}</script>
      </body>`,
      {
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        url: 'https://ark.test/preview',
        beforeParse(window) {
          const sections = () => [...window.document.querySelectorAll('.slides > section')]
          Object.defineProperty(window, 'Reveal', {
            configurable: true,
            value: {
              initialize() {
                return Promise.resolve()
              },
              getTotalSlides() {
                return sections().length
              },
              getCurrentSlide() {
                return sections()[current] ?? null
              },
              getSlidePastCount(slide: Element) {
                return Math.max(0, sections().indexOf(slide))
              },
              getSlides() {
                return sections()
              },
              getIndices(slide?: Element) {
                const index = slide ? sections().indexOf(slide) : current
                return { h: index, v: 0, f: 0 }
              },
              slide(h: number) {
                current = h
              },
              sync() {},
              on(event: string, handler: () => void) {
                if (event === 'slidechanged') {
                  revealHooks.slideChanged = handler
                }
              },
            },
          })
          captureParentMessages(window, messages)
        },
      },
    )

    await waitForLoad(dom)
    await Promise.resolve()
    await flush(dom)
    await flush(dom)

    dom.window.document.addEventListener(DECK_SLIDE_CHANGE_MESSAGE_TYPE, (event) => {
      customEvents.push((event as CustomEvent<{ index: number }>).detail.index)
    })

    expect(messages.some((message) => message.type === DECK_READY_MESSAGE_TYPE)).toBe(true)

    current = 1
    revealHooks.slideChanged?.()
    await flush(dom)

    expect(customEvents).toEqual([1])
    expect(messages).toContainEqual({ type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index: 1 })
    dom.window.close()
  })
})
