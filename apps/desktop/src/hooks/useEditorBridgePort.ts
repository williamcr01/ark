import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import {
  createEditorAssignIdMessage,
  createEditorCancelTextEditMessage,
  createEditorClearSelectionMessage,
  createEditorConfigureMessage,
  createEditorConnectAckMessage,
  createEditorDisableMessage,
  createEditorEnableMessage,
  createEditorRequestGeometryMessage,
  createEditorSelectMessage,
  createEditorSetToolMessage,
  createEditorStartTextEditMessage,
  createEditorTransformCancelMessage,
  createEditorTransformEndMessage,
  isEditorConnectMessage,
  isEditorRuntimeMessage,
  type EditorRuntimeMessage,
  type EditorShellMessage,
  type EditorTool,
  type EditorTransformPreviewMessage,
} from '@ark/editor-runtime'
import { isAllowedBridgeMessageOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

export type UseEditorBridgePortOptions = {
  enabled: boolean
  activeSlideIndex: number
  sandboxOrigin?: string | null
  iframeGenerationKey?: string
  sessionHandshake?: string | null
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
}

export type EditorBridgeCommands = {
  enableEditor: (slideIndex?: number, tool?: EditorTool, scale?: number) => boolean
  configureEditor: (scale: number) => boolean
  disableEditor: () => boolean
  selectElement: (elementId: string, slideIndex?: number) => boolean
  clearSelection: () => boolean
  requestGeometry: (elementId: string, slideIndex?: number) => boolean
  startTextEdit: (elementId: string, slideIndex?: number) => boolean
  cancelTextEdit: () => boolean
  setTool: (tool: EditorTool) => boolean
  assignElementId: (
    fromElementId: string,
    toElementId: string,
    slideIndex: number,
    managed?: boolean,
  ) => boolean
}

export function useEditorBridgePort(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  options: UseEditorBridgePortOptions,
  onRuntimeMessage: (data: EditorRuntimeMessage) => void,
) {
  const {
    enabled,
    activeSlideIndex,
    sandboxOrigin = null,
    iframeGenerationKey = '',
    sessionHandshake = null,
    canPostToFrame,
    shouldAcceptInbound,
  } = options

  const iframeGenerationRef = useRef(0)
  const editorPortRef = useRef<MessagePort | null>(null)
  const queuedShellMessagesRef = useRef<EditorShellMessage[]>([])
  const canPostToFrameRef = useRef(canPostToFrame)
  const shouldAcceptInboundRef = useRef(shouldAcceptInbound)
  const enabledRef = useRef(enabled)
  const transformPreviewRef = useRef<EditorTransformPreviewMessage | null>(null)
  const transformPreviewListenerRef = useRef<
    ((preview: EditorTransformPreviewMessage | null) => void) | null
  >(null)
  const runtimeMessageHandlerRef = useRef(onRuntimeMessage)

  useLayoutEffect(() => {
    enabledRef.current = enabled
    canPostToFrameRef.current = canPostToFrame
    shouldAcceptInboundRef.current = shouldAcceptInbound
    runtimeMessageHandlerRef.current = onRuntimeMessage
  }, [canPostToFrame, enabled, onRuntimeMessage, shouldAcceptInbound])

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

      if (!iframeRef.current?.contentWindow) {
        return false
      }

      const port = editorPortRef.current

      if (port) {
        port.postMessage(message)
      } else {
        queuedShellMessagesRef.current = [...queuedShellMessagesRef.current.slice(-31), message]
      }

      return true
    },
    [iframeRef],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

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

  const setTransformPreviewListener = useCallback(
    (listener: ((preview: EditorTransformPreviewMessage | null) => void) | null) => {
      transformPreviewListenerRef.current = listener
      listener?.(transformPreviewRef.current)
    },
    [],
  )

  const publishTransformPreview = useCallback((preview: EditorTransformPreviewMessage | null) => {
    transformPreviewRef.current = preview
    transformPreviewListenerRef.current?.(preview)
  }, [])

  const commands: EditorBridgeCommands = {
    enableEditor: useCallback(
      (slideIndex = activeSlideIndex, tool: EditorTool = 'select', scale?: number) =>
        postToFrame(createEditorEnableMessage(slideIndex, tool, scale)),
      [activeSlideIndex, postToFrame],
    ),
    configureEditor: useCallback(
      (scale: number) => postToFrame(createEditorConfigureMessage(scale)),
      [postToFrame],
    ),
    disableEditor: useCallback(() => postToFrame(createEditorDisableMessage()), [postToFrame]),
    selectElement: useCallback(
      (elementId: string, slideIndex = activeSlideIndex) =>
        postToFrame(createEditorSelectMessage(elementId, slideIndex)),
      [activeSlideIndex, postToFrame],
    ),
    clearSelection: useCallback(
      () => postToFrame(createEditorClearSelectionMessage()),
      [postToFrame],
    ),
    requestGeometry: useCallback(
      (elementId: string, slideIndex = activeSlideIndex) =>
        postToFrame(createEditorRequestGeometryMessage(elementId, slideIndex)),
      [activeSlideIndex, postToFrame],
    ),
    startTextEdit: useCallback(
      (elementId: string, slideIndex = activeSlideIndex) =>
        postToFrame(createEditorStartTextEditMessage(elementId, slideIndex)),
      [activeSlideIndex, postToFrame],
    ),
    cancelTextEdit: useCallback(
      () => postToFrame(createEditorCancelTextEditMessage()),
      [postToFrame],
    ),
    setTool: useCallback(
      (tool: EditorTool) => postToFrame(createEditorSetToolMessage(tool)),
      [postToFrame],
    ),
    assignElementId: useCallback(
      (fromElementId: string, toElementId: string, slideIndex: number, managed?: boolean) =>
        postToFrame(createEditorAssignIdMessage(fromElementId, toElementId, slideIndex, managed)),
      [postToFrame],
    ),
  }

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

  return {
    commands,
    enabledRef,
    iframeGenerationRef,
    postToFrame,
    publishTransformPreview,
    shouldAcceptInboundRef,
    setTransformPreviewListener,
    transformPreviewRef,
  }
}
