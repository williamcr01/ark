import { useEffect } from 'react'

import type { UseEditorRuntimePatchesOptions } from './useEditorCommitPatches.ts'

function useEditorShortcutPatch(options: UseEditorRuntimePatchesOptions) {
  const {
    duplicateElement,
    editChromeActive,
    handleDuplicateSelection,
    handleRedo,
    handleUndo,
    iframeKey,
    isTextEditSaving,
    lastShortcutRequest,
    selection,
    session,
    textEditActive,
    transformCommit,
    transformPreview,
  } = options
  const { pendingReselectRef, pendingTransformPatchRef, processed, scopeGenerationRef } = session

  useEffect(() => {
    if (!lastShortcutRequest) return
    const key = `${iframeKey}:${lastShortcutRequest.sequence}`
    if (processed.shortcut.current === key) return
    processed.shortcut.current = key

    if (lastShortcutRequest.action === 'duplicate') {
      if (!selection || selection.locked || !editChromeActive || textEditActive) return
      const pendingTransform = pendingTransformPatchRef.current
      if (pendingTransform) {
        const generation = scopeGenerationRef.current
        const { elementId, slideIndex, slideId } = selection
        void pendingTransform
          .then((result) => {
            if (scopeGenerationRef.current !== generation) return
            return duplicateElement(
              result?.patch.changedElementIds[0] ?? elementId,
              slideIndex,
              slideId,
            )
          })
          .catch(() => undefined)
        return
      }
      if (transformPreview || isTextEditSaving) return
      if (transformCommit) {
        void duplicateElement(
          pendingReselectRef.current?.elementId ?? selection.elementId,
          selection.slideIndex,
          selection.slideId,
        )
        return
      }
      handleDuplicateSelection()
      return
    }

    if (transformPreview || pendingTransformPatchRef.current || isTextEditSaving) return
    if (lastShortcutRequest.action === 'undo') handleUndo()
    else handleRedo()
  }, [
    duplicateElement,
    editChromeActive,
    handleDuplicateSelection,
    handleRedo,
    handleUndo,
    iframeKey,
    isTextEditSaving,
    lastShortcutRequest,
    pendingReselectRef,
    pendingTransformPatchRef,
    processed.shortcut,
    scopeGenerationRef,
    selection,
    textEditActive,
    transformCommit,
    transformPreview,
  ])
}

function useEditorPreserveSlidePatch(options: UseEditorRuntimePatchesOptions) {
  const { goToSlide, iframeKey, previewContentRevision, session } = options
  const { preserveSlideIndexRef } = session

  useEffect(() => {
    if (preserveSlideIndexRef.current === null) return
    const slideIndex = preserveSlideIndexRef.current
    preserveSlideIndexRef.current = null
    goToSlide(slideIndex)
  }, [goToSlide, iframeKey, preserveSlideIndexRef, previewContentRevision])
}

function useEditorReselectPatch(options: UseEditorRuntimePatchesOptions) {
  const {
    activeSlideIndex,
    editChromeActive,
    editorReady,
    iframeKey,
    onSelectElement,
    selection,
    session,
  } = options
  const { pendingReselectRef } = session

  useEffect(() => {
    const pending = pendingReselectRef.current
    if (!pending) return
    if (!editChromeActive) {
      pendingReselectRef.current = null
      return
    }
    if (pending.iframeKey === iframeKey) return
    if (!editorReady || activeSlideIndex !== pending.slideIndex) return
    if (selection?.elementId) {
      pendingReselectRef.current = null
      return
    }
    pendingReselectRef.current = null
    onSelectElement(pending.elementId, pending.slideIndex)
  }, [
    activeSlideIndex,
    editChromeActive,
    editorReady,
    iframeKey,
    onSelectElement,
    pendingReselectRef,
    selection?.elementId,
  ])
}

export function useEditorShortcutPatches(options: UseEditorRuntimePatchesOptions) {
  useEditorShortcutPatch(options)
  useEditorPreserveSlidePatch(options)
  useEditorReselectPatch(options)
}
