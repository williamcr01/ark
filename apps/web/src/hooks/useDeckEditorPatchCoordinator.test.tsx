import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDeckEditorPatchCoordinator } from './useDeckEditorPatchCoordinator'
import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'

const selection: EditorSelectionInfo = {
  elementId: 'element-a',
  slideIndex: 0,
  slideId: 'slide-a',
  tagName: 'p',
  locked: false,
  managed: true,
  editableKind: 'text',
  textPreview: 'Before',
}

function options() {
  return {
    activeSlideIndex: 0,
    canRedo: false,
    canUndo: false,
    editChromeActive: true,
    editorReady: true,
    geometry: null,
    iframeKey: 'frame-a',
    isTextEditSaving: false,
    lastDeleteRequest: null,
    lastInsertRequest: null,
    lastShortcutRequest: null,
    lastTextCommit: null,
    onCommitTextEdit: vi.fn(),
    onPatchEditorOperations: vi.fn().mockResolvedValue(undefined),
    onRedo: vi.fn(),
    onSelectElement: vi.fn(),
    onSelectTool: vi.fn(),
    onUndo: vi.fn(),
    preserveRedoSlideIndex: null,
    preserveUndoSlideIndex: null,
    previewHtml: '<section>Before</section>',
    selection,
    scopeKey: 'deck-a',
    textEditActive: false,
    transformCancelSequence: 0,
    transformCommit: null,
    transformPreview: null,
    beginLivePatch: vi.fn(() => true),
    finishLivePatch: vi.fn(),
    goToSlide: vi.fn(),
    rollbackLivePatch: vi.fn(),
  } satisfies Parameters<typeof useDeckEditorPatchCoordinator>[0]
}

describe('useDeckEditorPatchCoordinator', () => {
  it('deduplicates an editor event but permits a later retry after failure', async () => {
    const callbacks = options()
    callbacks.onCommitTextEdit.mockRejectedValueOnce(new Error('save failed'))
    const commit = {
      elementId: 'element-a',
      slideIndex: 0,
      slideId: 'slide-a',
      text: 'After',
      originalText: 'Before',
    }
    const view = renderHook(
      ({ lastTextCommit }) => useDeckEditorPatchCoordinator({ ...callbacks, lastTextCommit }),
      {
        initialProps: { lastTextCommit: commit as typeof callbacks.lastTextCommit | typeof commit },
      },
    )

    await waitFor(() => expect(callbacks.rollbackLivePatch).toHaveBeenCalledOnce())
    view.rerender({ lastTextCommit: null })
    callbacks.onCommitTextEdit.mockResolvedValueOnce(undefined)
    view.rerender({ lastTextCommit: { ...commit } })

    await waitFor(() => expect(callbacks.onCommitTextEdit).toHaveBeenCalledTimes(2))
    expect(callbacks.finishLivePatch).toHaveBeenCalledOnce()
  })

  it('does not automatically reselect over a newer user selection', () => {
    const callbacks = options()
    const view = renderHook(
      ({ currentSelection, iframeKey }) =>
        useDeckEditorPatchCoordinator({
          ...callbacks,
          iframeKey,
          selection: currentSelection,
        }),
      { initialProps: { currentSelection: selection, iframeKey: 'frame-a' } },
    )

    view.result.current.handleInspectorApply(
      [{ op: 'set_attrs', elementId: 'element-a', slideIndex: 0, attrs: { title: 'x' } }],
      'Update title',
    )
    view.rerender({
      currentSelection: { ...selection, elementId: 'element-b' },
      iframeKey: 'frame-b',
    })

    expect(callbacks.onSelectElement).not.toHaveBeenCalled()
  })

  it('ignores stale async completions after the deck scope changes', async () => {
    const callbacks = options()
    let resolveCommit: ((value: undefined) => void) | undefined
    callbacks.onCommitTextEdit.mockReturnValue(
      new Promise<undefined>((resolve) => {
        resolveCommit = resolve
      }),
    )
    const commit = {
      elementId: 'element-a',
      slideIndex: 0,
      slideId: 'slide-a',
      text: 'After',
      originalText: 'Before',
    }
    const view = renderHook(
      ({ scopeKey, lastTextCommit }) =>
        useDeckEditorPatchCoordinator({ ...callbacks, scopeKey, lastTextCommit }),
      {
        initialProps: {
          scopeKey: 'deck-a' as string,
          lastTextCommit: commit as typeof commit | null,
        },
      },
    )
    await waitFor(() => expect(callbacks.onCommitTextEdit).toHaveBeenCalledOnce())

    view.rerender({ scopeKey: 'deck-b', lastTextCommit: null })
    await act(async () => resolveCommit?.(undefined))

    expect(callbacks.finishLivePatch).not.toHaveBeenCalled()
    expect(callbacks.rollbackLivePatch).not.toHaveBeenCalled()
  })
})
