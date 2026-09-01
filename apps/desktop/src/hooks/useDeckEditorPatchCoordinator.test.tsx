import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDeckEditorPatchCoordinator } from './useDeckEditorPatchCoordinator'
import { createEditorDeleteRequestMessage, type EditorSelectionInfo } from '@ark/editor-runtime'

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
    previewContentRevision: 0,
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
    onAssignElementId: vi.fn(),
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

  it('clears deferred slide/reselection after a successful live patch', async () => {
    const callbacks = options()
    callbacks.onCommitTextEdit.mockResolvedValue({
      deck: { html: '<section>After</section>' },
      patch: {
        appliedCount: 1,
        changedSlideIndexes: [0],
        changedElementIds: ['element-a'],
        summary: 'Updated text',
      },
    })
    const commit = {
      elementId: 'element-a',
      slideIndex: 0,
      slideId: 'slide-a',
      text: 'After',
      originalText: 'Before',
    }
    const view = renderHook(
      ({ activeSlideIndex, iframeKey, lastTextCommit, previewContentRevision, currentSelection }) =>
        useDeckEditorPatchCoordinator({
          ...callbacks,
          activeSlideIndex,
          iframeKey,
          lastTextCommit,
          previewContentRevision,
          selection: currentSelection,
        }),
      {
        initialProps: {
          activeSlideIndex: 0,
          iframeKey: 'frame-a',
          lastTextCommit: null as typeof commit | null,
          previewContentRevision: 0,
          currentSelection: selection as EditorSelectionInfo | null,
        },
      },
    )

    view.rerender({
      activeSlideIndex: 0,
      iframeKey: 'frame-a',
      lastTextCommit: commit,
      previewContentRevision: 0,
      currentSelection: selection,
    })
    await waitFor(() => expect(callbacks.finishLivePatch).toHaveBeenCalledOnce())

    // User navigates away, then an unrelated preview reload occurs.
    view.rerender({
      activeSlideIndex: 1,
      iframeKey: 'frame-a',
      lastTextCommit: null,
      previewContentRevision: 0,
      currentSelection: null,
    })
    view.rerender({
      activeSlideIndex: 1,
      iframeKey: 'frame-b',
      lastTextCommit: null,
      previewContentRevision: 1,
      currentSelection: null,
    })

    expect(callbacks.goToSlide).not.toHaveBeenCalled()
    expect(callbacks.onSelectElement).not.toHaveBeenCalled()
  })

  it('stamps a stable id onto the live DOM after an adopted transform live patch', async () => {
    const callbacks = options()
    callbacks.onPatchEditorOperations.mockResolvedValue({
      deck: { html: '<section><h1 data-ark-id="ark-el-title">Title</h1></section>' },
      patch: {
        appliedCount: 1,
        changedSlideIndexes: [0],
        changedElementIds: ['ark-el-title'],
        summary: 'Updated element layout in preview',
      },
    })
    const transformCommit = {
      type: 'ark:editor-transform-commit' as const,
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      geometry: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 },
      adopted: true as const,
      cssX: 0.1,
      cssY: 0.2,
      cssWidth: 0.4,
      slideWidth: 1280,
      slideHeight: 720,
    }
    renderHook(
      ({ transformCommit: commit }) =>
        useDeckEditorPatchCoordinator({ ...callbacks, transformCommit: commit }),
      { initialProps: { transformCommit } },
    )

    await waitFor(() => expect(callbacks.finishLivePatch).toHaveBeenCalledOnce())
    expect(callbacks.onAssignElementId).toHaveBeenCalledWith(
      'transient-el-0-0',
      'ark-el-title',
      0,
      true,
    )
  })

  it('keeps deferred reselect when the patch result cannot retain live HTML', async () => {
    const callbacks = options()
    callbacks.selection = {
      ...selection,
      elementId: 'transient-el-0-0',
      managed: false,
    }
    callbacks.onPatchEditorOperations.mockResolvedValue({
      patch: {
        appliedCount: 1,
        changedSlideIndexes: [0],
        changedElementIds: ['ark-el-stable'],
        summary: 'Updated element layout in preview',
      },
    })
    const transformCommit = {
      type: 'ark:editor-transform-commit' as const,
      elementId: 'transient-el-0-0',
      slideIndex: 0,
      geometry: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 },
      adopted: true as const,
      cssX: 0.1,
      cssY: 0.2,
      cssWidth: 0.4,
      slideWidth: 1280,
      slideHeight: 720,
    }
    const view = renderHook(
      ({ transformCommit: commit, iframeKey, currentSelection }) =>
        useDeckEditorPatchCoordinator({
          ...callbacks,
          transformCommit: commit,
          iframeKey,
          selection: currentSelection,
        }),
      {
        initialProps: {
          transformCommit: transformCommit as typeof transformCommit | null,
          iframeKey: 'frame-a',
          currentSelection: callbacks.selection as EditorSelectionInfo | null,
        },
      },
    )

    await waitFor(() => expect(callbacks.finishLivePatch).toHaveBeenCalledOnce())
    expect(callbacks.onAssignElementId).not.toHaveBeenCalled()

    view.rerender({
      transformCommit: null,
      iframeKey: 'frame-b',
      currentSelection: null,
    })

    expect(callbacks.onSelectElement).toHaveBeenCalledWith('ark-el-stable', 0)
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

  it('patches every companion on a group transform commit', async () => {
    const callbacks = options()
    const companion = { ...selection, elementId: 'element-b', textPreview: 'Other' }
    renderHook(() =>
      useDeckEditorPatchCoordinator({
        ...callbacks,
        selections: [selection, companion],
        transformCommit: {
          type: 'ark:editor-transform-commit',
          elementId: 'element-a',
          slideIndex: 0,
          geometry: { x: 0.2, y: 0.3, width: 0.3, height: 0.1 },
          companions: [
            {
              elementId: 'element-b',
              slideIndex: 0,
              geometry: { x: 0.5, y: 0.3, width: 0.2, height: 0.1 },
            },
          ],
        },
      }),
    )

    await waitFor(() => expect(callbacks.onPatchEditorOperations).toHaveBeenCalledOnce())
    expect(callbacks.onPatchEditorOperations.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'move_element', elementId: 'element-a' }),
        expect.objectContaining({ op: 'move_element', elementId: 'element-b' }),
      ]),
    )
  })

  it('deletes every unlocked selected element from one delete request', async () => {
    const callbacks = options()
    const companion = { ...selection, elementId: 'element-b', textPreview: 'Other' }
    renderHook(() =>
      useDeckEditorPatchCoordinator({
        ...callbacks,
        lastDeleteRequest: createEditorDeleteRequestMessage('element-a', 0),
        selections: [selection, companion],
      }),
    )

    await waitFor(() => expect(callbacks.onPatchEditorOperations).toHaveBeenCalledOnce())
    expect(callbacks.onPatchEditorOperations.mock.calls[0]?.[0]).toEqual([
      {
        op: 'delete_element',
        elementId: 'element-a',
        slideIndex: 0,
        slideId: 'slide-a',
      },
      {
        op: 'delete_element',
        elementId: 'element-b',
        slideIndex: 0,
        slideId: 'slide-a',
      },
    ])
  })
})
