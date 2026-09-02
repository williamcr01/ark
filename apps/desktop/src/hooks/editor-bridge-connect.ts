import {
  createEditorConnectAckMessage,
  isEditorConnectMessage,
  isEditorRuntimeMessage,
  type EditorRuntimeMessage,
  type EditorShellMessage,
} from '@ark/editor-runtime'
import { isAllowedBridgeMessageOrigin } from '@ark/runtime-registry/sandbox-origin.ts'
import type { MutableRefObject, RefObject } from 'react'

export function handleEditorConnect(
  event: MessageEvent,
  args: {
    messageGeneration: number
    iframeGenerationRef: MutableRefObject<number>
    iframeRef: RefObject<HTMLIFrameElement | null>
    sandboxOrigin: string | null
    expectedHandshake: string
    editorPortRef: MutableRefObject<MessagePort | null>
    queuedShellMessagesRef: MutableRefObject<EditorShellMessage[]>
    canPostToFrameRef: MutableRefObject<(() => boolean) | undefined>
    runtimeMessageHandlerRef: MutableRefObject<(data: EditorRuntimeMessage) => void>
  },
) {
  if (args.messageGeneration !== args.iframeGenerationRef.current) {
    return
  }

  const iframeWindow = args.iframeRef.current?.contentWindow

  if (!iframeWindow || event.source !== iframeWindow) {
    return
  }

  if (!isAllowedBridgeMessageOrigin(event.origin, args.sandboxOrigin)) {
    return
  }

  if (!isEditorConnectMessage(event.data) || event.data.handshake !== args.expectedHandshake) {
    return
  }

  const port = event.ports[0]

  if (!port) {
    return
  }

  if (args.editorPortRef.current) {
    port.close()
    return
  }

  args.editorPortRef.current = port
  port.onmessage = (portEvent) => {
    if (
      args.messageGeneration !== args.iframeGenerationRef.current ||
      !isEditorRuntimeMessage(portEvent.data)
    ) {
      return
    }

    args.runtimeMessageHandlerRef.current(portEvent.data)
  }
  port.start()
  port.postMessage(createEditorConnectAckMessage())

  const queued = args.queuedShellMessagesRef.current
  args.queuedShellMessagesRef.current = []

  if (!args.canPostToFrameRef.current || args.canPostToFrameRef.current()) {
    queued.forEach((message) => port.postMessage(message))
  }
}
