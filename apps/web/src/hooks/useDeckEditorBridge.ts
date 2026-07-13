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
  isEditorInsertRequestMessage,
  isEditorReadyMessage,
  isEditorRuntimeMessage,
  isEditorSelectionChangeMessage,
  isEditorTextCommitMessage,
  isEditorTextEditStateMessage,
  isEditorTransformCommitMessage,
  isEditorTransformPreviewMessage,
  isEditorDeleteRequestMessage,
  type EditorHoverMessage,
  type EditorInsertRequestMessage,
  type EditorNormalizedRect,
  type EditorSelectionInfo,
  type EditorTool,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
  type EditorDeleteRequestMessage,
  postEditorShellMessage,
} from '@ark/deck-core/deck-editor-bridge.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  isAllowedBridgeMessageOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

export type DeckEditorBridgeState = {
  editorReady: boolean
  selection: EditorSelectionInfo | null
  hover: Pick<EditorHoverMessage, 'elementId' | 'slideIndex'> | null
  geometry: EditorNormalizedRect | null
  /** Viewport-normalized slide box for composing overlay geometry. */
  slideBounds: EditorNormalizedRect | null
  selectionZIndex: number | null
  editorError: string | null
  transformPreview: EditorTransformPreviewMessage | null
  transformCommit: EditorTransformCommitMessage | null
  lastInsertRequest: EditorInsertRequestMessage | null
  lastDeleteRequest: EditorDeleteRequestMessage | null
  textEditActive: boolean
  hoverGeometry: EditorNormalizedRect | null
  hoverSlideBounds: EditorNormalizedRect | null
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
  /** Synchronous send gate from usePreviewBridgeSession.canPostToFrame. */
  canPostToFrame?: () => boolean
  /** When false, ignore inbound editor messages (session not armed). */
  shouldAcceptInbound?: () => boolean
  onSelectionChange?: (selection: EditorSelectionInfo | null) => void
  onEditorError?: (message: string, code?: string) => void
}

const initialState: DeckEditorBridgeState = {
  editorReady: false,
  selection: null,
  hover: null,
  geometry: null,
  slideBounds: null,
  selectionZIndex: null,
  editorError: null,
  transformPreview: null,
  transformCommit: null,
  lastInsertRequest: null,
  lastDeleteRequest: null,
  textEditActive: false,
  hoverGeometry: null,
  hoverSlideBounds: null,
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
    parentOrigin: _parentOrigin = null,
    iframeGenerationKey = '',
    canPostToFrame,
    shouldAcceptInbound,
    onSelectionChange,
    onEditorError,
  } = options

  const [state, setState] = useState<DeckEditorBridgeState>(initialState)
  const [trackedGenerationKey, setTrackedGenerationKey] = useState(iframeGenerationKey)
  const iframeGenerationRef = useRef(0)
  const canPostToFrameRef = useRef(canPostToFrame)
  const shouldAcceptInboundRef = useRef(shouldAcceptInbound)

  useEffect(() => {
    canPostToFrameRef.current = canPostToFrame
    shouldAcceptInboundRef.current = shouldAcceptInbound
  }, [canPostToFrame, shouldAcceptInbound])

  // Hard-reset when the preview iframe remounts. Same-iframe enableEditor keeps
  // in-flight commits; a new generation key is a boundary (React "adjust state
  // when a prop changes" pattern — not an effect).
  if (trackedGenerationKey !== iframeGenerationKey) {
    setTrackedGenerationKey(iframeGenerationKey)
    setState(initialState)
  }

  useEffect(() => {
    iframeGenerationRef.current += 1
  }, [iframeGenerationKey])

  const postToFrame = useCallback(
    (message: Parameters<typeof postEditorShellMessage>[1]) => {
      if (canPostToFrameRef.current && !canPostToFrameRef.current()) {
        return false
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return false
      }

      postEditorShellMessage(iframeWindow, message, DECK_BRIDGE_POST_MESSAGE_TARGET)
      return true
    },
    [iframeRef],
  )

  const enableEditor = useCallback(
    (slideIndex = activeSlideIndex, tool: EditorTool = 'select') => {
      // Preserve readiness and in-flight commit requests across re-enable so
      // DeckPreview can still apply them (and so we do not retrigger an
      // enable/ready loop when editorReady would flip false → true).
      // Do not preserve selection/geometry/text-edit UI state: slide-change
      // re-enables must not leave the inspector targeting another slide.
      setState((current) => ({
        ...initialState,
        editorError: null,
        editorReady: current.editorReady,
        lastInsertRequest: current.lastInsertRequest,
        lastDeleteRequest: current.lastDeleteRequest,
        transformCommit: current.transformCommit,
        lastTextCommit: current.lastTextCommit,
      }))
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

      if (shouldAcceptInboundRef.current && !shouldAcceptInboundRef.current()) {
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
        setState((current) => {
          const sameHover = current.hover?.elementId === data.elementId

          return {
            ...current,
            hover: { elementId: data.elementId, slideIndex: data.slideIndex },
            // Drop hover overlay when the pointer target changes so a stale
            // box from the previous element never briefly paints.
            hoverGeometry: sameHover ? current.hoverGeometry : null,
            hoverSlideBounds: sameHover ? current.hoverSlideBounds : null,
          }
        })
        return
      }

      if (isEditorSelectionChangeMessage(data)) {
        setState((current) => {
          const sameSelection =
            data.selection !== null &&
            current.selection?.elementId === data.selection.elementId &&
            current.selection.slideIndex === data.selection.slideIndex

          return {
            ...current,
            selection: data.selection,
            // Drop overlay geometry whenever selection identity changes so a
            // previous element's box never flashes on the new selection.
            geometry: sameSelection ? current.geometry : null,
            slideBounds: sameSelection ? current.slideBounds : null,
            selectionZIndex: sameSelection ? current.selectionZIndex : null,
            transformPreview: sameSelection ? current.transformPreview : null,
          }
        })
        onSelectionChange?.(data.selection)
        return
      }

      if (isEditorGeometryMessage(data)) {
        setState((current) => {
          if (current.selection?.elementId === data.elementId) {
            return {
              ...current,
              geometry: data.geometry,
              slideBounds: data.slideBounds ?? null,
              selectionZIndex: data.zIndex,
            }
          }

          if (current.hover?.elementId === data.elementId) {
            return {
              ...current,
              hoverGeometry: data.geometry,
              hoverSlideBounds: data.slideBounds ?? null,
            }
          }

          // Ignore late geometry for elements that are no longer selected or
          // hovered — never poison selection overlay state.
          return current
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

      if (isEditorInsertRequestMessage(data)) {
        setState((current) => ({
          ...current,
          lastInsertRequest: data,
        }))
        return
      }

      if (isEditorDeleteRequestMessage(data)) {
        setState((current) => ({
          ...current,
          lastDeleteRequest: data,
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
  }, [enabled, iframeGenerationKey, iframeRef, onEditorError, onSelectionChange, sandboxOrigin])

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
