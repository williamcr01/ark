import { describe, expect, it } from 'vitest'

import {
  EMPTY_HISTORY_STATE,
  EXTERNAL_COALESCE_IDLE_MS,
  recordDeckEdit,
  useEditorStore,
  type DeckEditHistoryEntry,
} from './editor-store.ts'

function makeManualEntry(id: string, slideIndex = 0): DeckEditHistoryEntry {
  return {
    beforeHtml: `<before-${id}>`,
    afterHtml: `<after-${id}>`,
    slideIndex,
    provenance: {
      source: 'manual',
      operation: 'replace_text',
      operations: ['replace_text'],
      slideIndexes: [slideIndex],
      elementIds: [id],
      summary: `Edited ${id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

function makeExternalEntry(
  beforeHtml: string,
  afterHtml: string,
  toolName: string,
  options: { clientName?: string | null; createdAt?: string } = {},
): DeckEditHistoryEntry {
  return {
    beforeHtml,
    afterHtml,
    slideIndex: 0,
    provenance: {
      source: 'external',
      clientName: options.clientName === undefined ? 'Codex' : options.clientName,
      toolName,
      summary: `Applied ${toolName}`,
      createdAt: options.createdAt ?? '2026-01-01T00:00:00.000Z',
    },
  }
}

const selection = {
  elementId: 'ark-el-1',
  slideIndex: 0,
  slideId: null,
  tagName: 'p',
  locked: false,
  managed: true,
  editableKind: 'text' as const,
  textPreview: 'Hello',
}

describe('useEditorStore', () => {
  it('select and clearSelection update the current selection set', () => {
    useEditorStore.getState().reset()
    useEditorStore.getState().select(selection, [selection])
    expect(useEditorStore.getState().editorSelection?.elementId).toBe('ark-el-1')
    expect(useEditorStore.getState().editorSelections).toHaveLength(1)

    useEditorStore.getState().clearSelection()
    expect(useEditorStore.getState().editorSelection).toBeNull()
    expect(useEditorStore.getState().editorSelections).toEqual([])
  })

  it('does not emit a new selection snapshot when the same set is selected again', () => {
    useEditorStore.getState().reset()
    useEditorStore.getState().select(selection, [selection])
    const first = useEditorStore.getState()
    useEditorStore.getState().select(selection, [selection])
    const second = useEditorStore.getState()
    expect(second.editorSelection).toBe(first.editorSelection)
    expect(second.editorSelections).toBe(first.editorSelections)
  })

  it('records history and supports undo/redo', () => {
    useEditorStore.getState().reset()
    useEditorStore.getState().recordEdit(makeManualEntry('a'))
    expect(useEditorStore.getState().history.pointer).toBe(0)

    useEditorStore.getState().commitUndo()
    expect(useEditorStore.getState().history.pointer).toBe(-1)

    useEditorStore.getState().commitRedo()
    expect(useEditorStore.getState().history.pointer).toBe(0)

    useEditorStore.getState().resetHistory()
    expect(useEditorStore.getState().history).toEqual(EMPTY_HISTORY_STATE)
  })

  it('toggleContextSlide adds and removes attached slides', () => {
    useEditorStore.getState().reset()
    const slides = [{ index: 0, outerHTML: '<section class="slide"><h1>One</h1></section>' }]
    expect(useEditorStore.getState().toggleContextSlide(0, slides).capped).toBe(false)
    expect(useEditorStore.getState().contextSlides).toEqual([{ slideIndex: 0 }])
    expect(useEditorStore.getState().toggleContextSlide(0, slides).capped).toBe(false)
    expect(useEditorStore.getState().contextSlides).toEqual([])
  })

  it('setStripOpen accepts a functional update', () => {
    useEditorStore.getState().reset()
    expect(useEditorStore.getState().isStripOpen).toBe(true)
    useEditorStore.getState().setStripOpen((open) => !open)
    expect(useEditorStore.getState().isStripOpen).toBe(false)
  })

  it('tracks selected tool, text-edit activity, and the active slide index', () => {
    useEditorStore.getState().reset()
    useEditorStore.getState().setSelectedTool('text')
    useEditorStore.getState().setTextEditActive(true)
    useEditorStore.getState().setActiveSlideIndex(2)
    expect(useEditorStore.getState().selectedTool).toBe('text')
    expect(useEditorStore.getState().textEditActive).toBe(true)
    expect(useEditorStore.getState().activeSlideIndex).toBe(2)

    useEditorStore.getState().setActiveSlideIndex((index) => index + 1)
    expect(useEditorStore.getState().activeSlideIndex).toBe(3)
  })
})

describe('recordDeckEdit coalescing', () => {
  it('does not record identical HTML', () => {
    const html = '<html>same</html>'
    const next = recordDeckEdit(EMPTY_HISTORY_STATE, {
      beforeHtml: html,
      afterHtml: html,
      slideIndex: 0,
      provenance: {
        source: 'agent',
        summary: 'Applied agent write',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(next).toEqual(EMPTY_HISTORY_STATE)
  })

  it('coalesces consecutive external writes inside the idle window', () => {
    const first = recordDeckEdit(
      EMPTY_HISTORY_STATE,
      makeExternalEntry('<a>', '<b>', 'edit_deck', {
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    )
    const coalesced = recordDeckEdit(
      first,
      makeExternalEntry('<b>', '<c>', 'edit_deck', {
        createdAt: new Date(
          Date.parse('2026-01-01T00:00:00.000Z') + EXTERNAL_COALESCE_IDLE_MS,
        ).toISOString(),
      }),
    )
    expect(coalesced.stack).toHaveLength(1)
    expect(coalesced.stack[0]?.afterHtml).toBe('<c>')
  })
})
