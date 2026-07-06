import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  createEditorCancelTextEditMessage,
  createEditorClearSelectionMessage,
  createEditorDisableMessage,
  createEditorEnableMessage,
  createEditorRequestGeometryMessage,
  createEditorSelectMessage,
  createEditorSetToolMessage,
  createEditorStartTextEditMessage,
  isEditorErrorMessage,
  isEditorGeometryMessage,
  isEditorHoverMessage,
  isEditorReadyMessage,
  isEditorRuntimeMessage,
  isEditorSelectionChangeMessage,
  isEditorTextCommitMessage,
  isEditorTextEditStateMessage,
  isEditorTransformCommitMessage,
  isEditorTransformPreviewMessage,
  type EditorHoverMessage,
  type EditorNormalizedRect,
  type EditorSelectionInfo,
  type EditorTool,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
  postEditorShellMessage,
} from '../../shared/deck-editor-bridge.ts'
import { getDeckBridgeTargetOrigin } from '../../shared/deck-bridge.ts'
import { isAllowedBridgeMessageOrigin } from '../../shared/sandbox-origin.ts'

export type DeckEditorBridgeState = {
  editorReady: boolean
  selection: EditorSelectionInfo | null
  hover: Pick<EditorHoverMessage, 'elementId' | 'slideIndex'> | null
  geometry: EditorNormalizedRect | null
  editorError: string | null
  transformPreview: EditorTransformPreviewMessage | null
  transformCommit: EditorTransformCommitMessage | null
  textEditActive: boolean
  hoverGeometry: EditorNormalizedRect | null
  lastTextCommit: {
    elementId: string
    slideIndex: number
    slideId: string | null
    text: string
    originalText: string
  } | null
}

export type UseDeckEditorBridgeOptions = {
  enabled: boolean
  activeSlideIndex: number
  sandboxOrigin?: string | null
  parentOrigin?: string | null
  iframeGenerationKey?: string
  onSelectionChange?: (selection: EditorSelectionInfo | null) => void
  onEditorError?: (message: string, code?: string) => void
}

const initialState: DeckEditorBridgeState = {
  editorReady: false,
  selection: null,
  hover: null,
  geometry: null,
  editorError: null,
  transformPreview: null,
  transformCommit: null,
  textEditActive: false,
  hoverGeometry: null,
  lastTextCommit: null,
}

export function useDeckEditorBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  options: UseDeckEditorBridgeOptions,
) {
  const {
    enabled,
    activeSlideIndex,
    sandboxOrigin = null,
    parentOrigin = null,
    iframeGenerationKey = '',
    onSelectionChange,
    onEditorError,
  } = options

  const [state, setState] = useState<DeckEditorBridgeState>(initialState)
  const iframeGenerationRef = useRef(0)

  useEffect(() => {
    iframeGenerationRef.current += 1
  }, [iframeGenerationKey])

  const postToFrame = useCallback(
    (message: Parameters<typeof postEditorShellMessage>[1]) => {
      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return false
      }

      postEditorShellMessage(
        iframeWindow,
        message,
        getDeckBridgeTargetOrigin(parentOrigin ?? undefined),
      )
      return true
    },
    [iframeRef, parentOrigin],
  )

  const enableEditor = useCallback(
    (slideIndex = activeSlideIndex, tool: EditorTool = 'select') => {
      setState({ ...initialState, editorError: null })
      return postToFrame(createEditorEnableMessage(slideIndex, tool))
    },
    [activeSlideIndex, postToFrame],
  )

  const disableEditor = useCallback(() => {
    const posted = postToFrame(createEditorDisableMessage())

    if (posted) {
      setState(initialState)
    }

    return posted
  }, [postToFrame])

  const selectElement = useCallback(
    (elementId: string, slideIndex = activeSlideIndex) =>
      postToFrame(createEditorSelectMessage(elementId, slideIndex)),
    [activeSlideIndex, postToFrame],
  )

  const clearSelection = useCallback(
    () => postToFrame(createEditorClearSelectionMessage()),
    [postToFrame],
  )

  const requestGeometry = useCallback(
    (elementId: string, slideIndex = activeSlideIndex) =>
      postToFrame(createEditorRequestGeometryMessage(elementId, slideIndex)),
    [activeSlideIndex, postToFrame],
  )

  const startTextEdit = useCallback(
    (elementId: string, slideIndex = activeSlideIndex) =>
      postToFrame(createEditorStartTextEditMessage(elementId, slideIndex)),
    [activeSlideIndex, postToFrame],
  )

  const cancelTextEdit = useCallback(
    () => postToFrame(createEditorCancelTextEditMessage()),
    [postToFrame],
  )

  const setTool = useCallback(
    (tool: EditorTool) => postToFrame(createEditorSetToolMessage(tool)),
    [postToFrame],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const messageGeneration = iframeGenerationRef.current

    const handleMessage = (event: MessageEvent) => {
      if (messageGeneration !== iframeGenerationRef.current) {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      if (!isAllowedBridgeMessageOrigin(event.origin, sandboxOrigin)) {
        return
      }

      const data = event.data

      if (!isEditorRuntimeMessage(data)) {
        return
      }

      if (isEditorReadyMessage(data)) {
        setState((current) => ({
          ...current,
          editorReady: true,
          editorError: null,
        }))
        return
      }

      if (isEditorHoverMessage(data)) {
        setState((current) => ({
          ...current,
          hover: { elementId: data.elementId, slideIndex: data.slideIndex },
          hoverGeometry: current.hover?.elementId === data.elementId ? current.hoverGeometry : null,
        }))
        return
      }

      if (isEditorSelectionChangeMessage(data)) {
        setState((current) => ({
          ...current,
          selection: data.selection,
        }))
        onSelectionChange?.(data.selection)
        return
      }

      if (isEditorGeometryMessage(data)) {
        setState((current) => {
          if (current.selection?.elementId === data.elementId) {
            return {
              ...current,
              geometry: data.geometry,
            }
          }

          if (current.hover?.elementId === data.elementId) {
            return {
              ...current,
              hoverGeometry: data.geometry,
            }
          }

          return {
            ...current,
            geometry: data.geometry,
          }
        })
        return
      }

      if (isEditorTextCommitMessage(data)) {
        setState((current) => ({
          ...current,
          textEditActive: false,
          lastTextCommit: {
            elementId: data.elementId,
            slideIndex: data.slideIndex,
            slideId: data.slideId,
            text: data.text,
            originalText: data.originalText,
          },
        }))
        return
      }

      if (isEditorTextEditStateMessage(data)) {
        setState((current) => ({
          ...current,
          textEditActive: data.active,
        }))
        return
      }

      if (isEditorTransformPreviewMessage(data)) {
        setState((current) => ({
          ...current,
          transformPreview: data,
          transformCommit: null,
        }))
        return
      }

      if (isEditorTransformCommitMessage(data)) {
        setState((current) => ({
          ...current,
          transformCommit: data,
          transformPreview: null,
        }))
        return
      }

      if (isEditorErrorMessage(data)) {
        setState((current) => ({
          ...current,
          editorError: data.message,
        }))
        onEditorError?.(data.message, data.code)
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [enabled, iframeRef, onEditorError, onSelectionChange, sandboxOrigin])

  return {
    ...state,
    enableEditor,
    disableEditor,
    selectElement,
    clearSelection,
    requestGeometry,
    startTextEdit,
    cancelTextEdit,
    setTool,
  }
}
