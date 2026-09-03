import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import {
  createEditorTransformCancelMessage,
  createEditorTransformEndMessage,
  type EditorRuntimeMessage,
  type EditorShellMessage,
  type EditorTransformPreviewMessage,
} from '@ark/editor-runtime'

import { useEditorBridgeCommands, type EditorBridgeCommands } from './useEditorBridgeCommands.ts'
import { useEditorBridgeConnect } from './useEditorBridgeConnect.ts'

export type { EditorBridgeCommands }

export type UseEditorBridgePortOptions = {
  enabled: boolean
  activeSlideIndex: number
  sandboxOrigin?: string | null
  iframeGenerationKey?: string
  sessionHandshake?: string | null
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
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

  const commands = useEditorBridgeCommands(postToFrame, activeSlideIndex)

  useEditorBridgeConnect({
    iframeRef,
    sandboxOrigin,
    sessionHandshake,
    iframeGenerationKey,
    iframeGenerationRef,
    editorPortRef,
    queuedShellMessagesRef,
    canPostToFrameRef,
    runtimeMessageHandlerRef,
  })

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
