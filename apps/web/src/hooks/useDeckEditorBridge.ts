import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import {
  createEditorConnectAckMessage,
  createEditorCancelTextEditMessage,
  createEditorClearSelectionMessage,
  createEditorConfigureMessage,
  createEditorDisableMessage,
  createEditorEnableMessage,
  createEditorRequestGeometryMessage,
  createEditorSelectMessage,
  createEditorSetToolMessage,
  createEditorStartTextEditMessage,
  createEditorAssignIdMessage,
  createEditorTransformCancelMessage,
  createEditorTransformEndMessage,
  isEditorErrorMessage,
  isEditorGeometryMessage,
  isEditorHoverMessage,
  isEditorInsertRequestMessage,
  isEditorReadyMessage,
  isEditorRuntimeMessage,
  isEditorSelectionChangeMessage,
  isEditorShortcutMessage,
  isEditorTextCommitMessage,
  isEditorTextEditStateMessage,
  isEditorTransformCancelMessage,
  isEditorTransformCommitMessage,
  isEditorTransformPreviewMessage,
  isEditorDeleteRequestMessage,
  isEditorConnectMessage,
  type EditorHoverMessage,
  type EditorInsertRequestMessage,
  type EditorNormalizedRect,
  type EditorSelectionInfo,
  type EditorShortcutMessage,
  type EditorTool,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
  type EditorDeleteRequestMessage,
  type EditorRuntimeMessage,
  type EditorShellMessage,
  postEditorShellMessage,
} from '@ark/deck-core/deck-editor-bridge.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  isAllowedBridgeMessageOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

export type DeckEditorBridgeState = {
  editorReady: boolean
  selection: EditorSelectionInfo | null
  hover: Pick<EditorHoverMessage, 'elementId' | 'slideIndex' | 'surface'> | null
  geometry: EditorNormalizedRect | null
  /** Viewport-normalized slide box for composing overlay geometry. */
  slideBounds: EditorNormalizedRect | null
  selectionZIndex: number | null
  editorError: string | null
  transformPreview: EditorTransformPreviewMessage | null
  transformCommit: EditorTransformCommitMessage | null
  transformCancelSequence: number
  lastInsertRequest: EditorInsertRequestMessage | null
  lastDeleteRequest: EditorDeleteRequestMessage | null
  lastShortcutRequest: (EditorShortcutMessage & { sequence: number }) | null
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
  /** Per-preview capability used to authenticate the private editor MessagePort. */
  sessionHandshake?: string | null
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
  transformCancelSequence: 0,
  lastInsertRequest: null,
  lastDeleteRequest: null,
  lastShortcutRequest: null,
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
    sessionHandshake = null,
    canPostToFrame,
    shouldAcceptInbound,
    onSelectionChange,
    onEditorError,
  } = options

  const [state, setState] = useState<DeckEditorBridgeState>(initialState)
  const [trackedGenerationKey, setTrackedGenerationKey] = useState(iframeGenerationKey)
  const iframeGenerationRef = useRef(0)
  const editorPortRef = useRef<MessagePort | null>(null)
  const queuedShellMessagesRef = useRef<EditorShellMessage[]>([])
  const canPostToFrameRef = useRef(canPostToFrame)
  const shouldAcceptInboundRef = useRef(shouldAcceptInbound)
  const enabledRef = useRef(enabled)

  useLayoutEffect(() => {
    enabledRef.current = enabled
    canPostToFrameRef.current = canPostToFrame
    shouldAcceptInboundRef.current = shouldAcceptInbound
  }, [canPostToFrame, enabled, shouldAcceptInbound])

  // Hard-reset when the preview iframe remounts. Same-iframe enableEditor keeps
  // in-flight commits; a new generation key is a boundary (React "adjust state
  // when a prop changes" pattern — not an effect).
  if (trackedGenerationKey !== iframeGenerationKey) {
    setTrackedGenerationKey(iframeGenerationKey)
    setState(initialState)
  }

  useLayoutEffect(() => {
    iframeGenerationRef.current += 1

    editorPortRef.current?.close()
    editorPortRef.current = null
    queuedShellMessagesRef.current = []

    return () => {
      editorPortRef.current?.close()
      editorPortRef.current = null
      queuedShellMessagesRef.current = []
    }
  }, [iframeGenerationKey])

  const postToFrame = useCallback(
    (message: EditorShellMessage) => {
      if (canPostToFrameRef.current && !canPostToFrameRef.current()) {
        return false
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return false
      }

      if (sessionHandshake?.trim()) {
        const port = editorPortRef.current

        if (port) {
          port.postMessage(message)
        } else {
          // The head bootstrap normally connects before the frame handshake
          // arms. Keep a small bounded queue for srcDoc/fast-cache races.
          queuedShellMessagesRef.current = [...queuedShellMessagesRef.current.slice(-31), message]
        }

        return true
      }

      postEditorShellMessage(iframeWindow, message, DECK_BRIDGE_POST_MESSAGE_TARGET)
      return true
    },
    [iframeRef, sessionHandshake],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    // pointerup outside the iframe should commit the last geometry (PowerPoint-
    // style). Only true cancellation (pointercancel) restores the snapshot.
    const endTransform = () => {
      postToFrame(createEditorTransformEndMessage())
    }
    const cancelTransform = () => {
      postToFrame(createEditorTransformCancelMessage())
    }

    window.addEventListener('pointerup', endTransform, true)
    window.addEventListener('pointercancel', cancelTransform, true)

    return () => {
      window.removeEventListener('pointerup', endTransform, true)
      window.removeEventListener('pointercancel', cancelTransform, true)
    }
  }, [enabled, postToFrame])

  const enableEditor = useCallback(
    (slideIndex = activeSlideIndex, tool: EditorTool = 'select', scale?: number) => {
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
        lastShortcutRequest: current.lastShortcutRequest,
        transformCommit: current.transformCommit,
        transformCancelSequence: current.transformCancelSequence,
        lastTextCommit: current.lastTextCommit,
      }))
      return postToFrame(createEditorEnableMessage(slideIndex, tool, scale))
    },
    [activeSlideIndex, postToFrame],
  )

  const configureEditor = useCallback(
    (scale: number) => postToFrame(createEditorConfigureMessage(scale)),
    [postToFrame],
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

  const assignElementId = useCallback(
    (fromElementId: string, toElementId: string, slideIndex: number, managed?: boolean) =>
      postToFrame(createEditorAssignIdMessage(fromElementId, toElementId, slideIndex, managed)),
    [postToFrame],
  )

  const handleRuntimeMessage = useCallback(
    (data: EditorRuntimeMessage) => {
      if (!enabledRef.current) {
        return
      }

      if (shouldAcceptInboundRef.current && !shouldAcceptInboundRef.current()) {
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
          hover: {
            elementId: data.elementId,
            slideIndex: data.slideIndex,
            ...(data.surface ? { surface: data.surface } : {}),
          },
          hoverGeometry: data.geometry ?? null,
          hoverSlideBounds: data.slideBounds ?? null,
        }))
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
              selection: data.surface
                ? { ...current.selection, surface: data.surface }
                : current.selection,
              geometry: data.geometry,
              slideBounds: data.slideBounds ?? null,
              selectionZIndex: data.zIndex,
            }
          }

          // Ignore late geometry for elements that are no longer selected.
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
        setState((current) => {
          if (current.selection?.elementId !== data.elementId) {
            return {
              ...current,
              transformPreview: data,
              transformCommit: null,
            }
          }

          return {
            ...current,
            transformPreview: data,
            transformCommit: null,
            // Keep overlay geometry in the same update so chrome does not lag a
            // frame behind the iframe transform preview.
            geometry: data.geometry,
            slideBounds: data.slideBounds ?? current.slideBounds,
            selectionZIndex:
              data.zIndex !== undefined && data.zIndex !== null
                ? data.zIndex
                : current.selectionZIndex,
          }
        })
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

      if (isEditorTransformCancelMessage(data)) {
        setState((current) => ({
          ...current,
          transformPreview: null,
          transformCommit: null,
          transformCancelSequence: current.transformCancelSequence + 1,
        }))
        return
      }

      if (isEditorShortcutMessage(data)) {
        setState((current) => ({
          ...current,
          lastShortcutRequest: {
            ...data,
            sequence: (current.lastShortcutRequest?.sequence ?? 0) + 1,
          },
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
    },
    [onEditorError, onSelectionChange],
  )
  const runtimeMessageHandlerRef = useRef(handleRuntimeMessage)

  useLayoutEffect(() => {
    runtimeMessageHandlerRef.current = handleRuntimeMessage
  }, [handleRuntimeMessage])

  useLayoutEffect(() => {
    const expectedHandshake = sessionHandshake?.trim()

    if (!expectedHandshake) {
      return
    }

    const messageGeneration = iframeGenerationRef.current

    const handleConnect = (event: MessageEvent) => {
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

      if (!isEditorConnectMessage(event.data) || event.data.handshake !== expectedHandshake) {
        return
      }

      const port = event.ports[0]

      if (!port) {
        return
      }

      if (editorPortRef.current) {
        port.close()
        return
      }

      editorPortRef.current = port
      port.onmessage = (portEvent) => {
        if (
          messageGeneration !== iframeGenerationRef.current ||
          !isEditorRuntimeMessage(portEvent.data)
        ) {
          return
        }

        runtimeMessageHandlerRef.current(portEvent.data)
      }
      port.start()
      port.postMessage(createEditorConnectAckMessage())

      const queued = queuedShellMessagesRef.current
      queuedShellMessagesRef.current = []

      if (!canPostToFrameRef.current || canPostToFrameRef.current()) {
        queued.forEach((message) => port.postMessage(message))
      }
    }

    window.addEventListener('message', handleConnect)

    return () => {
      window.removeEventListener('message', handleConnect)
      editorPortRef.current?.close()
      editorPortRef.current = null
      queuedShellMessagesRef.current = []
    }
  }, [iframeGenerationKey, iframeRef, sandboxOrigin, sessionHandshake])

  useEffect(() => {
    if (!enabled || sessionHandshake?.trim()) {
      return
    }

    const messageGeneration = iframeGenerationRef.current

    const handleLegacyMessage = (event: MessageEvent) => {
      if (messageGeneration !== iframeGenerationRef.current) {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (
        !iframeWindow ||
        event.source !== iframeWindow ||
        !isAllowedBridgeMessageOrigin(event.origin, sandboxOrigin) ||
        !isEditorRuntimeMessage(event.data)
      ) {
        return
      }

      runtimeMessageHandlerRef.current(event.data)
    }

    window.addEventListener('message', handleLegacyMessage)

    return () => {
      window.removeEventListener('message', handleLegacyMessage)
    }
  }, [enabled, iframeGenerationKey, iframeRef, sandboxOrigin, sessionHandshake])

  return {
    ...state,
    enableEditor,
    configureEditor,
    disableEditor,
    selectElement,
    clearSelection,
    requestGeometry,
    startTextEdit,
    cancelTextEdit,
    setTool,
    assignElementId,
  }
}
