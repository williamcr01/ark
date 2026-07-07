import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  EDITOR_DELETE_REQUEST_MESSAGE_TYPE,
  EDITOR_INSERT_REQUEST_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  createEditorTextCommitMessage,
  isEditorRuntimeMessage,
  parseEditorMessage,
} from '../../shared/deck-editor-bridge.ts'
import hostileEditorPostmessageDeck from '@/test/fixtures/hostile-editor-postmessage-deck.html?raw'
import hostileFormsDeck from '@/test/fixtures/hostile-forms-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import { getPreviewHtml } from '@/lib/deck-preview'
import { detectRuntimeMode } from '@/lib/deck-runtime'
import { parseDeckHtml } from '../../server/deck-parser.ts'
import { applyDeckPatches } from '../../server/deck-patch.ts'
import { validateDeckHtmlOnServer } from '../../server/deck-validate.ts'

const malformedEditorPayloads: unknown[] = [
  {
    type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
    elementId: 'forged-el',
    slideIndex: 0,
    text: 'Injected',
  },
  {
    type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
    elementId: 'forged-el',
    slideIndex: 0,
    slideId: null,
    text: 'Injected',
    originalText: 42,
  },
  {
    type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    elementId: 'forged-el',
    slideIndex: 0,
    geometry: { x: 99, y: 0, width: 0.2, height: 0.1 },
  },
  {
    type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    elementId: 'forged-el',
    slideIndex: 0,
    geometry: { x: 0, y: 0, width: 2, height: 0.1 },
  },
  {
    type: 'ark:editor-selection-change',
    selection: { elementId: 'evil', slideIndex: 0 },
  },
  {
    type: 'ark:editor-ready',
    slideIndex: 0,
    protocolVersion: 99,
  },
  { type: 'ark:editor-evil-hijack', slideIndex: 0 },
  null,
  undefined,
  'ark:editor-text-commit',
]

const wellFormedForgedCommit = {
  type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  elementId: 'ark-el-locked-victim',
  slideIndex: 0,
  slideId: null,
  text: 'Injected copy',
  originalText: 'Victim',
}

function loadExecutablePreview(html: string) {
  return new Promise<{ dom: JSDOM; parentMessages: unknown[] }>((resolve) => {
    const parentMessages: unknown[] = []
    let parentWindow: { postMessage: (message: unknown) => void }

    const dom = new JSDOM(html, {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'https://ark.test/preview?parent=https%3A%2F%2Fark.test',
      beforeParse(window) {
        parentWindow = {
          postMessage(message: unknown) {
            parentMessages.push(message)
          },
        }

        Object.defineProperty(window, 'parent', {
          configurable: true,
          value: parentWindow,
        })
      },
    })

    dom.window.addEventListener('load', () => resolve({ dom, parentMessages }))
  })
}

describe('manual editor security fixtures (#81)', () => {
  it.each(malformedEditorPayloads.map((payload, index) => [index, payload] as const))(
    'rejects malformed editor payload %i at the validator boundary',
    (_index, payload) => {
      expect(isEditorRuntimeMessage(payload)).toBe(false)
      expect(parseEditorMessage(payload)).toBeNull()
    },
  )

  it('accepts well-formed forged commits so the shell must enforce origin and source guards', () => {
    expect(isEditorRuntimeMessage(wellFormedForgedCommit)).toBe(true)
    expect(parseEditorMessage(wellFormedForgedCommit)).toEqual(wellFormedForgedCommit)
  })

  it('accepts only well-formed editor runtime messages', () => {
    const valid = createEditorTextCommitMessage(
      'ark-el-title',
      0,
      'Updated',
      'Opening',
      'ark-slide-1',
    )

    expect(isEditorRuntimeMessage(valid)).toBe(true)
    expect(parseEditorMessage(valid)).toEqual(valid)
  })

  it('keeps hostile editor deck scripts only in full-js preview mode', () => {
    expect(detectRuntimeMode(hostileEditorPostmessageDeck)).toBe('custom-js')

    const previewHtml = getPreviewHtml(hostileEditorPostmessageDeck)
    const editorPreviewHtml = getPreviewHtml(hostileEditorPostmessageDeck, { editorBridge: true })

    expect(previewHtml).toContain('data-ark-preview-bridge')
    expect(previewHtml).toContain('ark:editor-text-commit')
    expect(editorPreviewHtml).toContain('data-ark-preview-editor')
    expect(editorPreviewHtml).toContain('data-ark-preview-bridge')
  })

  it('filters hostile deck editor posts through validator and protocol checks', async () => {
    const previewHtml = getPreviewHtml(hostileEditorPostmessageDeck, { editorBridge: true })
    const { parentMessages } = await loadExecutablePreview(previewHtml)

    const accepted = parentMessages.filter((message) => isEditorRuntimeMessage(message))
    const findByType = (type: string) =>
      parentMessages.find(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === type,
      )
    const forgedReady = findByType('ark:editor-ready')
    const forgedCommit = findByType(EDITOR_TEXT_COMMIT_MESSAGE_TYPE)
    const forgedTransform = findByType(EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE)
    const forgedDelete = findByType(EDITOR_DELETE_REQUEST_MESSAGE_TYPE)
    const forgedInsert = findByType(EDITOR_INSERT_REQUEST_MESSAGE_TYPE)
    const forgedSelection = findByType(EDITOR_SELECTION_CHANGE_MESSAGE_TYPE)

    expect(forgedReady).toBeDefined()
    expect(forgedCommit).toBeDefined()
    expect(forgedTransform).toBeDefined()
    expect(forgedDelete).toBeDefined()
    expect(forgedInsert).toBeDefined()
    expect(forgedSelection).toBeDefined()

    expect(accepted.some((message) => message === forgedReady)).toBe(false)
    expect(accepted.some((message) => message === forgedTransform)).toBe(false)
    expect(accepted.some((message) => message === forgedInsert)).toBe(false)
    expect(accepted.some((message) => message === forgedSelection)).toBe(false)
    expect(accepted.some((message) => message === forgedCommit)).toBe(true)
    expect(accepted.some((message) => message === forgedDelete)).toBe(true)
    expect(
      accepted.every(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type !== 'ark:editor-ready',
      ),
    ).toBe(true)
  })

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
    const duplicateIdDeck = hostileEditorPostmessageDeck

    expect(
      applyDeckPatches(duplicateIdDeck, [
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

  it('covers css-only and full-js editor preview injection paths', () => {
    const cssPreview = getPreviewHtml(plainCssDeck, { editorBridge: true })
    const jsPreview = getPreviewHtml(hostileEditorPostmessageDeck, { editorBridge: true })

    expect(cssPreview).toContain('data-ark-preview-nav')
    expect(cssPreview).toContain('data-ark-preview-editor')
    expect(cssPreview).not.toContain('data-ark-preview-bridge')

    expect(jsPreview).toContain('data-ark-preview-bridge')
    expect(jsPreview).toContain('data-ark-preview-editor')
  })
})
