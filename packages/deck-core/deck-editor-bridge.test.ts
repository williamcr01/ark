import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  createEditorConfigureMessage,
  createEditorEnableMessage,
  createEditorGeometryMessage,
  createEditorHoverMessage,
  createEditorSelectionChangeMessage,
  createEditorShortcutMessage,
  createEditorTextCommitMessage,
  createEditorTextEditStateMessage,
  createEditorTransformCommitMessage,
  createEditorTransformCancelMessage,
  createEditorTransformPreviewMessage,
  buildDeckEditorBridgeRuntimeScript,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_CONFIGURE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_SHORTCUT_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  isEditorMessage,
  isEditorRuntimeMessage,
  isEditorSelectionInfo,
  isEditorShellMessage,
  parseEditorMessage,
} from './deck-editor-bridge'
import { INLINE_TEXT_EDITABLE_TAGS } from './deck-editable'

type RuntimeMessage = Record<string, unknown>

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
  options: { slideIndex?: number; slideSelectors?: string[] } = {},
) {
  const messages: RuntimeMessage[] = []
  let parentWindow: { postMessage: (message: RuntimeMessage) => void }
  const script = buildDeckEditorBridgeRuntimeScript({
    slideSelectors: options.slideSelectors ?? ['section.slide'],
  })
  const dom = new JSDOM(`<!doctype html><body>${markup}<script>${script}</script></body>`, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'https://ark.test/preview',
    beforeParse(window) {
      parentWindow = { postMessage: (message) => messages.push(message) }
      Object.defineProperty(window, 'parent', { configurable: true, value: parentWindow })
    },
  })

  await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve()))
  dom.window.dispatchEvent(
    new dom.window.MessageEvent('message', {
      data: {
        type: EDITOR_ENABLE_MESSAGE_TYPE,
        slideIndex: options.slideIndex ?? 0,
        tool: 'select',
      },
      source: parentWindow! as unknown as Window,
    }),
  )

  return { dom, messages }
}

function pointerEvent(dom: JSDOM, type: string, pointerId: number, clientX = 0, clientY = 0) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

describe('deck editor bridge protocol', () => {
  const selection = {
    elementId: 'ark-el-title',
    slideIndex: 0,
    slideId: 'ark-slide-1',
    tagName: 'h1',
    locked: false,
    managed: false,
    editableKind: null,
    textPreview: 'Opening',
  }

  it('creates shell and runtime messages with validated shapes', () => {
    expect(createEditorEnableMessage(1, 'text')).toEqual({
      type: EDITOR_ENABLE_MESSAGE_TYPE,
      slideIndex: 1,
      tool: 'text',
    })

    expect(createEditorSelectionChangeMessage(selection)).toEqual({
      type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
      selection,
    })

    expect(
      createEditorGeometryMessage('ark-el-title', 0, { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }),
    ).toEqual({
      type: EDITOR_GEOMETRY_MESSAGE_TYPE,
      elementId: 'ark-el-title',
      slideIndex: 0,
      geometry: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      zIndex: null,
    })

    expect(
      createEditorGeometryMessage(
        'ark-el-title',
        0,
        { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
        null,
        { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      ),
    ).toEqual({
      type: EDITOR_GEOMETRY_MESSAGE_TYPE,
      elementId: 'ark-el-title',
      slideIndex: 0,
      geometry: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      zIndex: null,
      slideBounds: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    })
  })

  it('keeps transform preview and commit messages distinct', () => {
    const geometry = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const slideBounds = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }

    expect(createEditorTransformPreviewMessage('ark-el-body', 0, geometry).type).toBe(
      EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    )
    expect(createEditorTransformCommitMessage('ark-el-body', 0, geometry).type).toBe(
      EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    )
    expect(createEditorTransformPreviewMessage('ark-el-body', 0, geometry).type).not.toBe(
      createEditorTransformCommitMessage('ark-el-body', 0, geometry).type,
    )
    expect(
      createEditorTransformPreviewMessage('ark-el-body', 0, geometry, null, slideBounds),
    ).toMatchObject({ slideBounds })
    expect(
      createEditorTransformCommitMessage('ark-el-body', 0, geometry, 2, slideBounds),
    ).toMatchObject({ slideBounds, zIndex: 2 })
  })

  it('validates editor messages and rejects malformed payloads', () => {
    expect(isEditorShellMessage(createEditorEnableMessage(0))).toBe(true)
    expect(isEditorShellMessage(createEditorTransformCancelMessage())).toBe(true)
    expect(isEditorRuntimeMessage(createEditorSelectionChangeMessage(selection))).toBe(true)
    expect(
      isEditorRuntimeMessage(
        createEditorTextCommitMessage('ark-el-title', 0, 'Updated', 'Opening', null),
      ),
    ).toBe(true)
    expect(isEditorRuntimeMessage(createEditorTextEditStateMessage(true, 'ark-el-title', 0))).toBe(
      true,
    )
    expect(isEditorRuntimeMessage(createEditorTextEditStateMessage(false))).toBe(true)
    expect(isEditorMessage({ type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE, text: 'Nope' })).toBe(false)
    expect(isEditorMessage({ type: 'ark:editor-evil', slideIndex: 0 })).toBe(false)
    expect(
      parseEditorMessage(
        createEditorTransformCommitMessage('ark-el-body', 0, {
          x: 0,
          y: 0,
          width: 0.2,
          height: 0.1,
        }),
      ),
    ).toMatchObject({ type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE })
    expect(parseEditorMessage(null)).toBeNull()
  })

  it('validates optional editing overhaul fields and new messages', () => {
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }
    const slideBounds = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }

    expect(createEditorEnableMessage(0, 'select', 0.5)).toMatchObject({ scale: 0.5 })
    expect(createEditorConfigureMessage(0.5)).toEqual({
      type: EDITOR_CONFIGURE_MESSAGE_TYPE,
      scale: 0.5,
    })
    expect(isEditorSelectionInfo({ ...selection, surface: 'dark', geometryEditable: true })).toBe(
      true,
    )
    expect(
      isEditorRuntimeMessage(
        createEditorHoverMessage(0, 'ark-el-title', geometry, slideBounds, 'dark'),
      ),
    ).toBe(true)
    expect(
      isEditorRuntimeMessage(
        createEditorGeometryMessage('ark-el-title', 0, geometry, null, slideBounds, 'dark'),
      ),
    ).toBe(true)
    expect(
      isEditorRuntimeMessage(
        createEditorTransformCommitMessage(
          'ark-el-title',
          0,
          geometry,
          null,
          slideBounds,
          true,
          -0.1,
          0.2,
          0.5,
          0.25,
          960,
          700,
        ),
      ),
    ).toBe(true)
    expect(createEditorShortcutMessage('undo')).toEqual({
      type: EDITOR_SHORTCUT_MESSAGE_TYPE,
      action: 'undo',
    })
    expect(createEditorTransformCancelMessage()).toEqual({
      type: EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
    })
    expect(isEditorRuntimeMessage(createEditorTransformCancelMessage())).toBe(true)

    const invalidMessages = [
      { type: EDITOR_ENABLE_MESSAGE_TYPE, slideIndex: 0, scale: 0 },
      { type: EDITOR_CONFIGURE_MESSAGE_TYPE, scale: Number.NaN },
      createEditorSelectionChangeMessage({ ...selection, surface: 'medium' as never }),
      { ...createEditorHoverMessage(0, 'ark-el-title'), geometry: { ...geometry, x: 2 } },
      { ...createEditorGeometryMessage('ark-el-title', 0, geometry), surface: 'medium' },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), adopted: false },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), cssX: Number.NaN },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), cssX: 11 },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), cssHeight: Number.NaN },
      { ...createEditorTransformCommitMessage('ark-el-title', 0, geometry), slideWidth: 0 },
      { type: EDITOR_SHORTCUT_MESSAGE_TYPE, action: 'paste' },
    ]

    for (const message of invalidMessages) {
      expect(isEditorMessage(message)).toBe(false)
    }
  })

  it('accepts optional inspector selection fields (issue #84)', () => {
    expect(
      isEditorSelectionInfo({
        ...selection,
        role: 'title',
        textStyle: {
          fontSize: 32,
          fontWeight: '700',
          color: 'rgb(15, 23, 42)',
          textAlign: 'left',
          lineHeight: 40,
        },
        imageNaturalSize: null,
      }),
    ).toBe(true)

    expect(
      isEditorSelectionInfo({
        ...selection,
        role: null,
        textStyle: null,
        imageNaturalSize: { width: 800, height: 600 },
      }),
    ).toBe(true)

    // lineHeight "normal" is reported as null.
    expect(
      isEditorSelectionInfo({
        ...selection,
        textStyle: {
          fontSize: 18,
          fontWeight: '400',
          color: 'rgb(0, 0, 0)',
          textAlign: 'center',
          lineHeight: null,
        },
      }),
    ).toBe(true)
  })

  it('rejects malformed inspector selection fields', () => {
    expect(isEditorSelectionInfo({ ...selection, role: 5 })).toBe(false)
    expect(isEditorSelectionInfo({ ...selection, textStyle: { fontSize: 'big' } })).toBe(false)
    expect(
      isEditorSelectionInfo({
        ...selection,
        textStyle: {
          fontSize: 18,
          fontWeight: 400,
          color: 'rgb(0, 0, 0)',
          textAlign: 'left',
          lineHeight: null,
        },
      }),
    ).toBe(false)
    expect(isEditorSelectionInfo({ ...selection, imageNaturalSize: { width: 800 } })).toBe(false)
    expect(
      isEditorSelectionInfo({
        ...selection,
        imageNaturalSize: { width: Number.NaN, height: 10 },
      }),
    ).toBe(false)
  })

  it('rejects hostile editor payloads with invalid geometry and incomplete fields', () => {
    const hostilePayloads = [
      createEditorGeometryMessage('ark-el-title', 0, { x: 1.5, y: 0, width: 0.2, height: 0.1 }),
      createEditorGeometryMessage('ark-el-title', 0, { x: 0, y: -0.1, width: 0.2, height: 0.1 }),
      createEditorTransformCommitMessage('ark-el-body', 0, { x: 0, y: 0, width: 2, height: 0.1 }),
      {
        type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
        selection: { elementId: 'evil', slideIndex: 0 },
      },
      {
        type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
        elementId: 'evil',
        slideIndex: 0,
        text: 'Injected',
      },
      {
        type: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
        active: true,
      },
      {
        type: EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
        elementId: 'evil',
        slideIndex: 0,
        geometry: { x: '0', y: 0, width: 0.2, height: 0.1 },
      },
    ]

    for (const payload of hostilePayloads) {
      expect(isEditorRuntimeMessage(payload)).toBe(false)
      expect(parseEditorMessage(payload)).toBeNull()
    }
  })

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
    expect(script).toContain('managedAncestor.contains(selectedElement)')
    expect(script).toContain('function selectParent(slide)')
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

    // Third click must stay on the drilled child (not bounce back to the group).
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 3, 130, 130))
    copy.dispatchEvent(pointerEvent(dom, 'pointerup', 3, 130, 130))

    const reclickSelections = messages
      .filter((message) => message.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE)
      .map((message) => (message.selection as { elementId: string }).elementId)
    expect(reclickSelections).toEqual(['copy'])
    messages.length = 0

    // Click-drag after drill must move the child, not the container.
    copy.dispatchEvent(pointerEvent(dom, 'pointerdown', 4, 130, 130))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointermove', 4, 230, 130))
    dom.window.document.dispatchEvent(pointerEvent(dom, 'pointerup', 4, 230, 130))

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
    const { dom, messages } = await loadEditorRuntime(
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
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450))

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
      'function adoptMove(element, slide, geometry, logicalWidth, positionContext)',
    )
    expect(script).toContain('adopted: adopted ? true : undefined')
    expect(script).toContain(
      'function snapMoveRect(rect, snapRects, slide, disabled, constrainedAxis)',
    )
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
    Object.defineProperty(heading, 'offsetWidth', { configurable: true, value: 200 })
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
    const { dom, messages } = await loadEditorRuntime(
      '<div class="reveal"><div class="slides"><section class="slide"><h1 id="heading">Title</h1></section></div></div>',
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
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450))

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
    const { dom, messages } = await loadEditorRuntime(
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
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450))

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
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450))

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

  it.each(['pointercancel', 'lostpointercapture', 'pointerout'])(
    '%s restores an adopted drag snapshot',
    async (type) => {
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
      dom.window.document.dispatchEvent(pointerEvent(dom, type, 9, 360, 160))

      expect(capturedPointer).toBe(9)
      expect(heading.parentElement).toBe(container)
      expect(heading.nextElementSibling).toBe(after)
      expect(heading.getAttribute('style')).toBe('color: red')
      expect(
        messages.some((message) => message.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE),
      ).toBe(true)
      expect(
        messages.some((message) => message.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE),
      ).toBe(false)
      dom.window.close()
    },
  )
})
