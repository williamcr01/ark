import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react'

import type { EditorRuntimeMessage, EditorShellMessage } from '@ark/editor-runtime'

import { handleEditorConnect } from './editor-bridge-connect.ts'

export function useEditorBridgeConnect(args: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  sandboxOrigin: string | null
  sessionHandshake: string | null
  iframeGenerationKey: string
  iframeGenerationRef: MutableRefObject<number>
  editorPortRef: MutableRefObject<MessagePort | null>
  queuedShellMessagesRef: MutableRefObject<EditorShellMessage[]>
  canPostToFrameRef: MutableRefObject<(() => boolean) | undefined>
  runtimeMessageHandlerRef: MutableRefObject<(data: EditorRuntimeMessage) => void>
}) {
  useLayoutEffect(() => {
    const expectedHandshake = args.sessionHandshake?.trim()

    if (!expectedHandshake) {
      return
    }

    const messageGeneration = args.iframeGenerationRef.current

    const onConnect = (event: MessageEvent) => {
      handleEditorConnect(event, {
        messageGeneration,
        iframeGenerationRef: args.iframeGenerationRef,
        iframeRef: args.iframeRef,
        sandboxOrigin: args.sandboxOrigin,
        expectedHandshake,
        editorPortRef: args.editorPortRef,
        queuedShellMessagesRef: args.queuedShellMessagesRef,
        canPostToFrameRef: args.canPostToFrameRef,
        runtimeMessageHandlerRef: args.runtimeMessageHandlerRef,
      })
    }

    window.addEventListener('message', onConnect)

    const editorPortRef = args.editorPortRef
    const queuedShellMessagesRef = args.queuedShellMessagesRef

    return () => {
      window.removeEventListener('message', onConnect)
      const port = editorPortRef.current
      editorPortRef.current = null
      port?.close()
      queuedShellMessagesRef.current = []
    }
  }, [
    args.canPostToFrameRef,
    args.editorPortRef,
    args.iframeGenerationKey,
    args.iframeGenerationRef,
    args.iframeRef,
    args.queuedShellMessagesRef,
    args.runtimeMessageHandlerRef,
    args.sandboxOrigin,
    args.sessionHandshake,
  ])
}
