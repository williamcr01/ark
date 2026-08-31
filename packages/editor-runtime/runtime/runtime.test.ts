import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  createEditorConnectAckMessage,
  createEditorTransformEndMessage,
  EDITOR_TRANSFORM_END_MESSAGE_TYPE,
  buildDeckEditorBridgeRuntimeScript,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_SHORTCUT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  EDITOR_CONNECT_MESSAGE_TYPE,
  EDITOR_SESSION_HANDOFF_KEY,
} from '../index.ts'
import { INLINE_TEXT_EDITABLE_TAGS } from '@ark/deck/document/editable.ts'

type RuntimeMessage = Record<string, unknown>

type TestMessageEvent = { data: unknown }

class TestMessagePort {
  peer: TestMessagePort | null = null
  onmessage: ((event: TestMessageEvent) => void) | null = null

  postMessage(data: unknown) {
    this.peer?.onmessage?.({ data })
  }

  start() {}

  close() {
    this.peer = null
    this.onmessage = null
  }
}

class TestMessageChannel {
  port1 = new TestMessagePort()
  port2 = new TestMessagePort()

  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

async function loadEditorRuntime(
  markup: string,
  options: {
    slideIndex?: number
    slideSelectors?: string[]
    /** Collapse the 400ms nudge idle timer. Disable for settle-sensitive cases. */
    accelerateNudgeTimer?: boolean
  } = {},
) {
  const messages: RuntimeMessage[] = []
  let parentWindow: {
    postMessage: (
      message: RuntimeMessage,
      targetOrigin?: string,
      transfer?: TestMessagePort[],
    ) => void
  }
  let shellPort: TestMessagePort | null = null
  let resolveConnected: (() => void) | null = null
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve
  })
  const accelerateNudgeTimer = options.accelerateNudgeTimer !== false
  const script = buildDeckEditorBridgeRuntimeScript({
    slideSelectors: options.slideSelectors ?? ['section.slide'],
    parentOrigin: 'https://ark.test',
  })
  const dom = new JSDOM(`<!doctype html><body>${markup}<script>${script}</script></body>`, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'https://ark.test/preview',
    beforeParse(window) {
      Object.defineProperty(window, EDITOR_SESSION_HANDOFF_KEY, {
        configurable: true,
        value: 'test-editor-session',
      })
      Object.defineProperty(window, 'MessageChannel', {
        configurable: true,
        value: TestMessageChannel,
      })
      parentWindow = {
        postMessage: (message, _targetOrigin, transfer) => {
          if (message.type !== EDITOR_CONNECT_MESSAGE_TYPE || !transfer?.[0]) {
            return
          }

          shellPort = transfer[0]
          shellPort.onmessage = (event) => {
            messages.push(event.data as RuntimeMessage)
          }
          shellPort.start()
          shellPort.postMessage(createEditorConnectAckMessage())
          resolveConnected?.()
        },
      }
      Object.defineProperty(window, 'parent', { configurable: true, value: parentWindow })
      // Nudge commit uses an exact 400ms idle timer; collapse only that delay so
      // coverage stays the same without sleeping wall-clock time per assertion.
      if (!accelerateNudgeTimer) {
        return
      }
      const nativeSetTimeout = window.setTimeout.bind(window) as typeof window.setTimeout
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        nativeSetTimeout(
          handler,
          timeout === 400 ? 0 : (timeout ?? 0),
          ...args,
        )) as typeof window.setTimeout
    },
  })

  await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve()))
  await connected
  shellPort?.postMessage({
    type: EDITOR_ENABLE_MESSAGE_TYPE,
    slideIndex: options.slideIndex ?? 0,
    tool: 'select',
    protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
  })

  const flushNudgeTimer = () =>
    new Promise<void>((resolve) => {
      dom.window.setTimeout(resolve, accelerateNudgeTimer ? 0 : 450)
    })

  return { dom, messages, flushNudgeTimer, shellPort: shellPort! }
}

function pointerEvent(
  dom: JSDOM,
  type: string,
  pointerId: number,
  clientX = 0,
  clientY = 0,
  keys: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    clientX,
    clientY,
    shiftKey: Boolean(keys.shiftKey),
    metaKey: Boolean(keys.metaKey),
    ctrlKey: Boolean(keys.ctrlKey),
  })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

describe('deck editor runtime script', () => {
  it('embeds shared inline text tags and text-edit lifecycle hooks in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    for (const tag of INLINE_TEXT_EDITABLE_TAGS) {
      expect(script).toContain(`"${tag}"`)
    }

    expect(script).toContain(EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE)
    expect(script).toContain('originalText')
    expect(script).toContain('ArrowLeft')
  })

  it('posts slideBounds with geometry and transform messages in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    expect(script).toContain('function normalizeSlideBounds')
    expect(script).toContain('slideBounds: normalizeSlideBounds(slide)')

    const selectHandler = script.indexOf('data.type === C.SELECT ||')
    const setIndex = script.indexOf('currentSlideIndex = data.slideIndex', selectHandler)
    const getSlide = script.indexOf('var slide = getActiveSlide();', setIndex)

    expect(selectHandler).toBeGreaterThan(-1)
    expect(setIndex).toBeGreaterThan(selectHandler)
    expect(getSlide).toBeGreaterThan(setIndex)
  })

  it('widens selectable elements and prefers managed wrappers', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    const findTargetIndex = script.indexOf('function findEditableTarget')
    expect(findTargetIndex).toBeGreaterThan(-1)

    for (const tag of [
      'div',
      'section',
      'ul',
      'ol',
      'table',
      'blockquote',
      'pre',
      'figure',
      'a',
      'hr',
    ]) {
      expect(script).toContain(`tag === '${tag}'`)
    }

    expect(script).toContain('if (!bounds.width || !bounds.height)')
    const ancestorPreferenceIndex = script.indexOf('managedAncestor === selectedElement ||')
    expect(ancestorPreferenceIndex).toBeGreaterThan(findTargetIndex)
    expect(script).toContain(
      'selectedElement && managedAncestor && managedAncestor.contains(selectedElement)',
    )
    expect(script).toContain('function selectParent(slide)')
  })

  it('keeps pointer hit-testing alive after selecting a plain flow element', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 data-ark-id="title">Opening</h1><p data-ark-id="copy">Body</p></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const title = dom.window.document.querySelector<HTMLElement>('h1')!
    const copy = dom.window.document.querySelector<HTMLElement>('p')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    title.getBoundingClientRect = () => rect(100, 80, 400, 60)
    copy.getBoundingClientRect = () => rect(100, 180, 400, 40)

    title.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 120, 100))
    title.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 120, 100))
    messages.length = 0

    // Previously threw when selectedElement was set and managedAncestor was null.
    expect(() => {
      title.dispatchEvent(pointerEvent(dom, 'pointermove', 1, 130, 105))
      copy.dispatchEvent(pointerEvent(dom, 'pointermove', 1, 120, 190))
      copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 120, 190))
      copy.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 120, 190))
    }).not.toThrow()

    const selections = messages
      .filter((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE)
      .map((message) => (message.selection as { elementId: string }).elementId)
    expect(selections).toEqual(['copy'])
    dom.window.close()
  })

  it('starts inline editing when selected text is clicked again without dragging', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 data-ark-id="title">Opening</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const title = dom.window.document.querySelector<HTMLElement>('h1')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    title.getBoundingClientRect = () => rect(100, 80, 400, 60)

    title.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 120, 100))
    title.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 120, 100))
    expect(title.hasAttribute('contenteditable')).toBe(false)
    messages.length = 0

    title.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 120, 100))
    title.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 120, 100))

    expect(title.getAttribute('contenteditable')).toBe('true')
    expect(messages).toContainEqual({
      type: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
      active: true,
      elementId: 'title',
      slideIndex: 0,
    })
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      false,
    )
    dom.window.close()
  })

  it('toggles a same-slide selection set with Shift or Cmd/Ctrl click and posts selections', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 data-ark-id="title">Opening</h1><p data-ark-id="copy">Body</p></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const title = dom.window.document.querySelector<HTMLElement>('h1')!
    const copy = dom.window.document.querySelector<HTMLElement>('p')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    title.getBoundingClientRect = () => rect(100, 80, 400, 60)
    copy.getBoundingClientRect = () => rect(100, 180, 400, 40)

    title.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 120, 100))
    title.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 120, 100))
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 120, 190, { shiftKey: true }))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 120, 190, { shiftKey: true }))

    const last = [...messages]
      .reverse()
      .find((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE) as {
      selection: { elementId: string }
      selections: { elementId: string }[]
    }
    expect(last.selection.elementId).toBe('copy')
    expect(last.selections.map((item) => item.elementId)).toEqual(['title', 'copy'])
    expect(title.getAttribute('data-ark-editor-selected')).toBe('')
    expect(copy.getAttribute('data-ark-editor-selected')).toBe('primary')

    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 3, 120, 190, { metaKey: true }))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 3, 120, 190, { metaKey: true }))
    const afterToggle = [...messages]
      .reverse()
      .find((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE) as {
      selection: { elementId: string }
      selections: { elementId: string }[]
    }
    expect(afterToggle.selection.elementId).toBe('title')
    expect(afterToggle.selections.map((item) => item.elementId)).toEqual(['title'])
    dom.window.close()
  })

  it('clears a multi-element selection set on Escape', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 data-ark-id="title">Opening</h1><p data-ark-id="copy">Body</p></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const title = dom.window.document.querySelector<HTMLElement>('h1')!
    const copy = dom.window.document.querySelector<HTMLElement>('p')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    title.getBoundingClientRect = () => rect(100, 80, 400, 60)
    copy.getBoundingClientRect = () => rect(100, 180, 400, 40)

    title.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 120, 100))
    title.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 120, 100))
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 120, 190, { ctrlKey: true }))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 120, 190, { ctrlKey: true }))
    messages.length = 0

    slide.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(messages).toContainEqual({ type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE, selection: null })
    expect(title.hasAttribute('data-ark-editor-selected')).toBe(false)
    expect(copy.hasAttribute('data-ark-editor-selected')).toBe(false)
    dom.window.close()
  })

  it('drills into an already-selected managed container', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div data-ark-id="group" data-ark-managed="true"><p data-ark-id="copy">Copy</p></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const group = dom.window.document.querySelector<HTMLElement>('div')!
    const copy = dom.window.document.querySelector<HTMLElement>('p')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    group.getBoundingClientRect = () => rect(100, 100, 400, 200)
    copy.getBoundingClientRect = () => rect(120, 120, 300, 60)

    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 130, 130))
    copy.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))

    const selections = messages
      .filter((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE)
      .map((message) => (message.selection as { elementId: string }).elementId)
    expect(selections).toEqual(['group', 'copy', 'copy'])
    expect(copy.getAttribute('contenteditable')).toBe('true')
    dom.window.close()
  })

  it('keeps a drilled child selected on re-click and lets it drag', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div data-ark-id="group" data-ark-managed="true"><p data-ark-id="copy">Copy</p></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const group = dom.window.document.querySelector<HTMLElement>('div')!
    const copy = dom.window.document.querySelector<HTMLElement>('p')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    group.getBoundingClientRect = () => rect(100, 100, 400, 200)
    copy.getBoundingClientRect = () =>
      copy.style.position === 'absolute'
        ? rect(
            Number.parseFloat(copy.style.left),
            Number.parseFloat(copy.style.top),
            Number.parseFloat(copy.style.width) || 300,
            60,
          )
        : rect(120, 120, 300, 60)
    Object.defineProperty(copy, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(copy, 'offsetWidth', { configurable: true, value: 300 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    // First click selects the group; second drills into the child.
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 130, 130))
    messages.length = 0

    // Dragging the selected text still moves it instead of entering text edit.
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 3, 130, 130))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 3, 230, 130))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 3, 230, 130))

    const commit = messages.find((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)
    expect(commit).toMatchObject({
      elementId: 'copy',
      adopted: true,
    })
    expect(copy.style.position).toBe('absolute')
    expect(group.style.position).not.toBe('absolute')
    dom.window.close()
  })

  it('double-clicks nested inline markup inside a drilled group into text edit', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div data-ark-id="group" data-ark-managed="true"><p data-ark-id="copy"><strong>Bold</strong></p></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const group = dom.window.document.querySelector<HTMLElement>('div')!
    const copy = dom.window.document.querySelector<HTMLElement>('p')!
    const strong = dom.window.document.querySelector<HTMLElement>('strong')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    group.getBoundingClientRect = () => rect(100, 100, 400, 200)
    copy.getBoundingClientRect = () => rect(120, 120, 300, 60)
    strong.getBoundingClientRect = () => rect(120, 120, 80, 60)

    strong.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 130, 130))
    strong.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 130, 130))
    strong.dispatchEvent(pointerEvent(dom, 'pointerdown', 2, 130, 130))
    strong.dispatchEvent(pointerEvent(dom, 'pointerup', 2, 130, 130))
    strong.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))

    const selections = messages
      .filter((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE)
      .map((message) => (message.selection as { elementId: string }).elementId)
    expect(selections).toEqual(['group', 'copy', 'copy'])
    expect(copy.getAttribute('contenteditable')).toBe('true')
    dom.window.close()
  })

  it('flattens vertical Reveal slides to Ark linear indexes', async () => {
    const { dom, messages, flushNudgeTimer } = await loadEditorRuntime(
      '<div class="reveal"><div class="slides"><section><section><h2 id="a">A</h2></section><section><h2 id="b">B</h2></section></section><section><h2 id="c">C</h2></section></div></div>',
      {
        slideIndex: 1,
        slideSelectors: ['.slides > section', '.reveal .slides > section'],
      },
    )
    const canvas = dom.window.document.querySelector<HTMLElement>('.slides')!
    const heading = dom.window.document.querySelector<HTMLElement>('#b')!
    const slide = heading.parentElement!

    canvas.getBoundingClientRect = () => rect(0, 0, 960, 700)
    slide.getBoundingClientRect = () => rect(0, 0, 960, 700)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            60,
          )
        : rect(100, 100, 300, 60)
    Object.defineProperties(canvas, {
      offsetWidth: { configurable: true, value: 960 },
      offsetHeight: { configurable: true, value: 700 },
    })
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 300 })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 12, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 12, 110, 110))
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    await flushNudgeTimer()

    const selection = messages.find(
      (message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
    )
    const commit = messages.find((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)
    expect(selection?.selection).toMatchObject({ slideIndex: 1, textPreview: 'B' })
    expect(commit).toMatchObject({ slideIndex: 1, slideWidth: 960, slideHeight: 700 })
    dom.window.close()
  })

  it('deselects on empty-slide pointerdown in the runtime script', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    const emptyClickIndex = script.indexOf('var target = findEditableTarget(event.target, slide);')
    expect(emptyClickIndex).toBeGreaterThan(-1)

    const deselectIndex = script.indexOf(
      'postSelection(null, slide, currentSlideIndex);',
      emptyClickIndex,
    )
    expect(deselectIndex).toBeGreaterThan(emptyClickIndex)

    const hoverClearIndex = script.indexOf('elementId: null', deselectIndex)
    expect(hoverClearIndex).toBeGreaterThan(deselectIndex)
  })

  it('adds adaptive, scale-compensated editor chrome and inline hover geometry', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain('function detectSurface(element, slide)')
    expect(script).toContain("return luminance >= 0.5 ? 'light' : 'dark'")
    expect(script).toContain('surface: detectSurface(element, slide)')
    expect(script).toContain('geometry: target ? normalizeRect(target, slide) : undefined')
    expect(script).toContain('var hitSize = 18 / editorScale')
    expect(script).toContain('var visualSize = 10 / editorScale')
    expect(script).toContain('handle.style.cursor = cursors[handles[i]]')
    expect(script).toContain('data-ark-editor-movable')
    expect(script).toContain('data.type === C.CONFIGURE')
    expect(script).toContain("tag === 'svg'")
    expect(script).toContain("tag === 'picture'")
  })

  it('supports adopt-on-move, snapping, modifiers, nudge, shortcuts, and unlocked delete', () => {
    const script = buildDeckEditorBridgeRuntimeScript({
      slideSelectors: ['section.slide'],
    })

    expect(script).toContain(
      'function adoptMove(element, slide, geometry, logicalWidth, positionContext',
    )
    expect(script).toContain('function insertAdoptSpacer(element, slide, cache)')
    expect(script).toContain('function removeAdoptSpacer(cache)')
    expect(script).toContain('data-ark-spacer')
    expect(script).toContain('adopted: adopted ? true : undefined')
    expect(script).toContain('spacer: adopted && spacerFootprint ? spacerFootprint : undefined')
    expect(script).toContain(
      'function snapMoveRect(rect, snapRects, slide, disabled, constrainedAxis',
    )
    expect(script).toContain('function applySnapGuides(slide, guides, cache)')
    expect(script).toContain('liveTransform:')
    expect(script).toContain('liveTransformBase')
    expect(script).toContain("willChange = 'transform'")
    expect(script).toContain('data.type === C.TRANSFORM_END')
    expect(script).toContain('candidates.length < 60')
    expect(script).not.toContain('!isManagedElement(element)')
    expect(script).toContain('event.altKey')
    expect(script).toContain('event.shiftKey')
    expect(script).toContain('window.setTimeout(finishNudge, 400)')
    expect(script).toContain('postToParent({ type: C.SHORTCUT, action: action })')
    expect(script).toContain('restoreInlineStyle(transformState.element, transformState.snapshot)')
    expect(script).toContain('data.type === C.TRANSFORM_CANCEL')

    const enableIndex = script.indexOf('function enableEditor')
    const finishNudgeIndex = script.indexOf('finishNudge();', enableIndex)
    const cancelTransformIndex = script.indexOf('cancelTransform(previousSlide);', enableIndex)
    const setSlideIndex = script.indexOf('currentSlideIndex = slideIndex;', enableIndex)
    expect(finishNudgeIndex).toBeGreaterThan(enableIndex)
    expect(cancelTransformIndex).toBeGreaterThan(finishNudgeIndex)
    expect(setSlideIndex).toBeGreaterThan(cancelTransformIndex)

    const deleteHandlerIndex = script.indexOf("event.key === 'Delete'")
    expect(deleteHandlerIndex).toBeGreaterThan(-1)
    expect(script.indexOf('!isManagedElement(selectedElement)', deleteHandlerIndex)).toBe(-1)
    expect(
      script.indexOf("selectedElement.getAttribute(C.LOCKED_ATTR) === 'true'", deleteHandlerIndex),
    ).toBeGreaterThan(deleteHandlerIndex)
  })

  it('keeps nested adoption in its container while committing visual and CSS geometry', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div id="container" style="position: relative"><h1 id="heading">Title</h1></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const container = dom.window.document.querySelector<HTMLElement>('#container')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!
    let capturedPointer: number | null = null

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    container.getBoundingClientRect = () => rect(200, 100, 800, 400)
    heading.getBoundingClientRect = () => {
      if (heading.style.position === 'absolute') {
        const parentLeft = heading.parentElement === container ? 200 : 0
        const parentTop = heading.parentElement === container ? 100 : 0
        return rect(
          parentLeft + Number.parseFloat(heading.style.left) * 2,
          parentTop + Number.parseFloat(heading.style.top) * 2,
          Number.parseFloat(heading.style.width) * 2,
          80,
        )
      }

      return rect(250, 150, 400, 80)
    }
    Object.defineProperty(heading, 'offsetParent', {
      configurable: true,
      get: () => container,
    })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })
    Object.defineProperties(container, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 200 },
    })
    Object.defineProperties(heading, {
      offsetWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 80 },
    })
    slide.setPointerCapture = (pointerId) => {
      capturedPointer = pointerId
    }

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 7, 260, 160))
    const selectedId = messages.find(
      (message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
    )?.selection as { elementId: string }
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 7, 360, 160))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 7, 360, 160))

    const commit = messages.find(
      (message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )!
    expect(capturedPointer).toBe(7)
    expect(heading.parentElement).toBe(container)
    expect(heading.style.left).toBe('75px')
    expect(heading.style.top).toBe('25px')
    expect(heading.style.width).toBe('200px')
    expect(heading.style.margin).toBe('0px')
    expect(heading.style.boxSizing).toBe('border-box')
    expect(commit.elementId).toBe(selectedId.elementId)
    expect(commit.geometry).toMatchObject({ x: 350 / 1280, y: 150 / 720, width: 400 / 1280 })
    expect(commit).toMatchObject({ cssX: 75 / 1280, cssY: 25 / 720, cssWidth: 200 / 1280 })
    expect(commit.adopted).toBe(true)
    expect(commit.spacer).toMatchObject({
      width: 200,
      height: 80,
      display: 'block',
    })
    const spacer = heading.previousElementSibling as HTMLElement | null
    expect(spacer?.getAttribute('data-ark-spacer')).toBe('true')
    expect(spacer?.getAttribute('aria-hidden')).toBe('true')
    expect(spacer?.style.width).toBe('200px')
    expect(spacer?.style.height).toBe('80px')
    expect(spacer?.style.visibility).toBe('hidden')
    expect(container.querySelectorAll('[data-ark-spacer]').length).toBe(1)
    dom.window.close()
  })

  it('moves an already-absolute nested element in containing-block coordinates', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div id="container" style="position: relative"><h1 id="heading" style="position: absolute; left: 50px; top: 50px; width: 400px; margin: 0">Title</h1></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const container = dom.window.document.querySelector<HTMLElement>('#container')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    container.getBoundingClientRect = () => rect(200, 100, 800, 400)
    heading.getBoundingClientRect = () =>
      rect(
        200 + Number.parseFloat(heading.style.left),
        100 + Number.parseFloat(heading.style.top),
        400,
        80,
      )
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => container })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })
    Object.defineProperties(container, {
      offsetWidth: { configurable: true, value: 800 },
      offsetHeight: { configurable: true, value: 400 },
    })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 8, 260, 160))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 8, 360, 160))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 8, 360, 160))

    const commit = messages.find(
      (message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )!
    const selection = messages.find(
      (message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
    )
    expect(heading.parentElement).toBe(container)
    expect(heading.style.left).toBe('150px')
    expect(heading.style.top).toBe('50px')
    expect(commit.geometry).toMatchObject({ x: 350 / 1280, y: 150 / 720 })
    expect(commit).toMatchObject({ cssX: 150 / 1280, cssY: 50 / 720 })
    expect(commit.adopted).toBeUndefined()
    expect(commit.spacer).toBeUndefined()
    expect(heading.previousElementSibling?.getAttribute('data-ark-spacer')).not.toBe('true')
    expect(selection?.selection).toMatchObject({ managed: true })
    dom.window.close()
  })

  it('uses the Reveal canvas when the section rect only covers its content', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<div class="reveal"><div class="slides"><section class="slide"><h1 id="heading">Title</h1></section></div></div>',
    )
    const canvas = dom.window.document.querySelector<HTMLElement>('.slides')!
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    canvas.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    slide.getBoundingClientRect = () =>
      heading.style.position === 'absolute' ? rect(0, 360, 0, 0) : rect(100, 100, 400, 80)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            360 + Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperties(canvas, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 80 },
    })
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 10, 110, 110))
    const initialGeometry = messages.find(
      (message) => message.type === EDITOR_GEOMETRY_MESSAGE_TYPE,
    )
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 10, 210, 110))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 10, 210, 110))

    const commit = messages.find(
      (message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )!
    expect(initialGeometry?.geometry).toMatchObject({
      x: 100 / 1280,
      y: 100 / 720,
      width: 400 / 1280,
      height: 80 / 720,
    })
    expect(heading.parentElement).toBe(slide)
    expect(heading.style.left).toBe('200px')
    expect(heading.style.top).toBe('-260px')
    expect(commit.geometry).toMatchObject({ x: 200 / 1280, y: 100 / 720, width: 400 / 1280 })
    expect(commit).toMatchObject({ cssX: 200 / 1280, cssY: -260 / 720, cssWidth: 400 / 1280 })
    expect(commit).toMatchObject({ slideWidth: 1280, slideHeight: 720 })
    dom.window.close()
  })

  it('commits intended nudge geometry after Reveal recenters a collapsed section', async () => {
    const { dom, messages, flushNudgeTimer } = await loadEditorRuntime(
      '<div class="reveal"><div class="slides"><section class="slide"><h1 id="heading">Title</h1></section></div></div>',
      { accelerateNudgeTimer: false },
    )
    const canvas = dom.window.document.querySelector<HTMLElement>('.slides')!
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!
    let collapsedTop = 360
    let absoluteRectReads = 0

    canvas.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    slide.getBoundingClientRect = () =>
      heading.style.position === 'absolute' ? rect(0, collapsedTop, 0, 0) : rect(100, 100, 400, 80)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            collapsedTop +
              Number.parseFloat(heading.style.top) +
              (absoluteRectReads++ === 0 ? 5 : 0),
            Number.parseFloat(heading.style.width),
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperties(canvas, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 80 },
    })
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    let revealLayoutCount = 0
    Object.defineProperty(dom.window, 'Reveal', {
      configurable: true,
      value: {
        layout() {
          revealLayoutCount += 1
          const localTop = Number.parseFloat(heading.style.top)
          if (Number.isFinite(localTop)) collapsedTop = 360 + (localTop + 260) / 2
        },
      },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 11, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 11, 110, 110))
    messages.length = 0
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        bubbles: true,
      }),
    )
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20))
    expect(heading.getBoundingClientRect().top).toBe(110)
    await flushNudgeTimer()

    const commit = messages.find(
      (message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )!
    expect(heading.getBoundingClientRect().top).toBe(110)
    expect(Number.parseFloat(heading.style.top)).toBeCloseTo(-253.333, 2)
    expect(commit.geometry).toMatchObject({ y: 110 / 720 })
    expect(commit.cssY).toBeCloseTo(-253.333 / 720, 4)
    expect(revealLayoutCount).toBeGreaterThan(0)
    dom.window.close()
  })

  it('cancels an uncommitted nudge locally instead of forwarding undo', async () => {
    const { dom, messages, flushNudgeTimer } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 3, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 3, 110, 110))
    messages.length = 0
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
    )
    await flushNudgeTimer()

    expect(heading.hasAttribute('style')).toBe(false)
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      true,
    )
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      false,
    )
    expect(messages.some((message) => message.type === EDITOR_SHORTCUT_MESSAGE_TYPE)).toBe(false)
    dom.window.close()
  })

  it('cancels an uncommitted nudge on Escape', async () => {
    const { dom, messages, flushNudgeTimer } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const heading = dom.window.document.querySelector<HTMLElement>('h1')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 3, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 3, 110, 110))
    messages.length = 0
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flushNudgeTimer()

    expect(heading.hasAttribute('style')).toBe(false)
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      true,
    )
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      false,
    )
    dom.window.close()
  })

  it('adopts an unmanaged element when resizing it', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const heading = dom.window.document.querySelector<HTMLElement>('h1')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            Number.parseFloat(heading.style.minHeight) || 80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 4, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 4, 110, 110))
    const handle = slide.querySelector<HTMLElement>('[data-ark-editor-handle="se"]')!
    messages.length = 0
    handle.dispatchEvent(pointerEvent(dom, 'pointerdown', 5, 500, 180))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 5, 600, 240))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 5, 600, 240))

    const commit = messages.find((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)
    expect(heading.style.position).toBe('absolute')
    expect(commit).toMatchObject({ adopted: true })
    expect((commit?.geometry as { width: number }).width).toBeGreaterThan(400 / 1280)
    dom.window.close()
  })

  it('does not adopt on a no-drag resize handle click', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const heading = dom.window.document.querySelector<HTMLElement>('h1')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () => rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 6, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 6, 110, 110))
    const handle = slide.querySelector<HTMLElement>('[data-ark-editor-handle="se"]')!
    messages.length = 0
    handle.dispatchEvent(pointerEvent(dom, 'pointerdown', 7, 500, 180))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 7, 500, 180))

    expect(heading.style.position).not.toBe('absolute')
    expect(heading.hasAttribute('style')).toBe(false)
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      false,
    )
    dom.window.close()
  })

  it('pointercancel restores an adopted drag snapshot', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div id="container"><h1 id="heading" style="color: red">Title</h1><span id="after">After</span></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const container = dom.window.document.querySelector<HTMLElement>('#container')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!
    const after = dom.window.document.querySelector<HTMLElement>('#after')!
    let capturedPointer: number | null = null

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    container.getBoundingClientRect = () => rect(200, 100, 800, 400)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            80,
          )
        : rect(250, 150, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    slide.setPointerCapture = (pointerId) => {
      capturedPointer = pointerId
    }

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 9, 260, 160))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 9, 360, 160))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointercancel', 9, 360, 160))

    expect(capturedPointer).toBe(9)
    expect(heading.parentElement).toBe(container)
    expect(heading.nextElementSibling).toBe(after)
    expect(heading.previousElementSibling?.getAttribute('data-ark-spacer')).not.toBe('true')
    expect(heading.getAttribute('style')).toBe('color: red')
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      true,
    )
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      false,
    )
    dom.window.close()
  })

  it('removes an early-adopted resize spacer on pointercancel', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1><p id="after">After</p></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section')!
    const heading = dom.window.document.querySelector<HTMLElement>('h1')!
    const after = dom.window.document.querySelector<HTMLElement>('#after')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left),
            Number.parseFloat(heading.style.top),
            Number.parseFloat(heading.style.width),
            Number.parseFloat(heading.style.minHeight) || 80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperties(heading, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 80 },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 11, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 11, 110, 110))
    const handle = slide.querySelector<HTMLElement>('[data-ark-editor-handle="se"]')!
    messages.length = 0
    handle.dispatchEvent(pointerEvent(dom, 'pointerdown', 12, 500, 180))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 12, 600, 240))
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()))
    expect(heading.previousElementSibling?.getAttribute('data-ark-spacer')).toBe('true')
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointercancel', 12, 600, 240))

    expect(heading.style.position).not.toBe('absolute')
    expect(heading.nextElementSibling).toBe(after)
    expect(slide.querySelectorAll('[data-ark-spacer]').length).toBe(0)
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      true,
    )
    // Cancel restores the pre-gesture snapshot, including clearing the
    // transient data-ark-id stamped only for adoption.
    expect(heading.hasAttribute('data-ark-id')).toBe(false)
    dom.window.close()
  })

  it('survives a y-only snap without crashing on sparse guide reuse', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute' ||
      heading.hasAttribute('data-ark-editor-live-transform')
        ? rect(
            Number.parseFloat(heading.style.left) || 100,
            Number.parseFloat(heading.style.top) || 100,
            Number.parseFloat(heading.style.width) || 400,
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    // Drag straight down so the element center hits the horizontal mid-line
    // (y = 0.5) with no x snap — ensureGuide only fills guideElements[1].
    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 15, 110, 110))
    expect(() => {
      dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 15, 110, 330))
    }).not.toThrow()
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))

    expect(slide.querySelector('[data-ark-editor-guide]')).not.toBeNull()
    expect(() => {
      dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 15, 110, 340))
    }).not.toThrow()
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))
    expect(() => {
      dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 15, 110, 340))
    }).not.toThrow()

    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      true,
    )
    dom.window.close()
  })

  it('preserves stylesheet-authored transforms during a live move preview', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<style>#heading { transform: translate(-50%, -50%); }</style><section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute'
        ? rect(
            Number.parseFloat(heading.style.left) || 200,
            Number.parseFloat(heading.style.top) || 100,
            Number.parseFloat(heading.style.width) || 400,
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 20, 110, 110))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 20, 210, 110))
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))

    expect(heading.style.transform).toBe('')
    expect(heading.hasAttribute('data-ark-editor-live-transform')).toBe(false)
    expect(dom.window.getComputedStyle(heading).transform).toContain('translate')

    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 20, 210, 110))
    expect(heading.style.transform).toBe('')
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      true,
    )
    dom.window.close()
  })

  it('composes a live move when inline transform is the none keyword', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading" style="transform: none">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () => rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 21, 110, 110))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 21, 210, 110))
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))

    expect(heading.style.transform).toMatch(/^translate\(/)
    expect(heading.style.transform).not.toContain('none')

    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 21, 210, 110))
    expect(heading.style.transform).toBe('none')
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      true,
    )
    dom.window.close()
  })

  it('cancels a started transform when the active slide disappears', async () => {
    const { dom, messages, shellPort } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () => rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 22, 110, 110))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 22, 210, 110))
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))
    messages.length = 0

    slide.remove()
    shellPort.postMessage(createEditorTransformEndMessage())

    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      true,
    )
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      false,
    )
    dom.window.close()
  })

  it('ark:editor-transform-end commits a started gesture at the last preview geometry', async () => {
    const { dom, messages, shellPort } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute' ||
      heading.hasAttribute('data-ark-editor-live-transform')
        ? rect(
            Number.parseFloat(heading.style.left) || 200,
            Number.parseFloat(heading.style.top) || 100,
            Number.parseFloat(heading.style.width) || 400,
            80,
          )
        : rect(100, 100, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 14, 110, 110))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 14, 210, 110))
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))
    const preview = messages.find(
      (message) => message.type === EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    )
    messages.length = 0

    shellPort.postMessage(createEditorTransformEndMessage())

    const commit = messages.find((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)
    expect(commit).toMatchObject({
      type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
      geometry: preview?.geometry,
    })
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      false,
    )
    expect(createEditorTransformEndMessage()).toEqual({ type: EDITOR_TRANSFORM_END_MESSAGE_TYPE })
    dom.window.close()
  })

  it('lostpointercapture commits a started gesture instead of cancelling', async () => {
    const { dom, messages } = await loadEditorRuntime(
      '<section class="slide"><div id="container"><h1 id="heading">Title</h1></div></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const container = dom.window.document.querySelector<HTMLElement>('#container')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    container.getBoundingClientRect = () => rect(200, 100, 800, 400)
    heading.getBoundingClientRect = () =>
      heading.style.position === 'absolute' ||
      heading.hasAttribute('data-ark-editor-live-transform')
        ? rect(
            Number.parseFloat(heading.style.left) || 350,
            Number.parseFloat(heading.style.top) || 150,
            Number.parseFloat(heading.style.width) || 400,
            80,
          )
        : rect(250, 150, 400, 80)
    Object.defineProperty(heading, 'offsetParent', { configurable: true, get: () => slide })
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperties(slide, {
      offsetWidth: { configurable: true, value: 1280 },
      offsetHeight: { configurable: true, value: 720 },
    })

    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 9, 260, 160))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 9, 360, 160))
    await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve(undefined)))
    messages.length = 0
    dom.window.document.dispatchEvent(pointerEvent(dom, 'lostpointercapture', 9, 360, 160))

    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)).toBe(
      true,
    )
    expect(messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE)).toBe(
      false,
    )
    expect(heading.style.position).toBe('absolute')
    dom.window.close()
  })

  it('assigns a stable id onto a transient live element', async () => {
    const { dom, messages, shellPort } = await loadEditorRuntime(
      '<section class="slide"><h1 id="heading">Title</h1></section>',
    )
    const slide = dom.window.document.querySelector<HTMLElement>('section.slide')!
    const heading = dom.window.document.querySelector<HTMLElement>('#heading')!

    slide.getBoundingClientRect = () => rect(0, 0, 1280, 720)
    heading.getBoundingClientRect = () => rect(100, 100, 400, 80)
    heading.dispatchEvent(pointerEvent(dom, 'pointerdown', 1, 110, 110))
    heading.dispatchEvent(pointerEvent(dom, 'pointerup', 1, 110, 110))

    const selection = messages.find(
      (message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
    )?.selection as { elementId: string }
    expect(selection.elementId).toMatch(/^transient-el-/)

    shellPort.postMessage({
      type: 'ark:editor-assign-id',
      fromElementId: selection.elementId,
      toElementId: 'ark-el-title',
      slideIndex: 0,
      managed: true,
    })

    expect(heading.getAttribute('data-ark-id')).toBe('ark-el-title')
    expect(heading.getAttribute('data-ark-managed')).toBe('true')
    const reselected = messages
      .filter((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE)
      .at(-1)?.selection as { elementId: string }
    expect(reselected.elementId).toBe('ark-el-title')
    dom.window.close()
  })
})
