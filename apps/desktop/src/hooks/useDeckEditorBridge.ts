import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

import type { EditorRuntimeMessage, EditorSelectionInfo } from '@ark/editor-runtime'

import { useEditorBridgePort, type UseEditorBridgePortOptions } from './useEditorBridgePort.ts'
import { useEditorBridgeMessages } from './useEditorBridgeMessages.ts'

export type { DeckEditorBridgeState } from '@/lib/editor/editor-bridge-state.ts'

export type UseDeckEditorBridgeOptions = UseEditorBridgePortOptions & {
  onSelectionChange?: (
    selection: EditorSelectionInfo | null,
    selections?: EditorSelectionInfo[],
  ) => void
  onEditorError?: (message: string, code?: string) => void
}

function assembleDeckEditorBridge(
  port: ReturnType<typeof useEditorBridgePort>,
  messages: ReturnType<typeof useEditorBridgeMessages>,
) {
  return {
    ...messages.overlay,
    transformPreviewRef: port.transformPreviewRef,
    setTransformPreviewListener: port.setTransformPreviewListener,
    enableEditor: messages.enableEditor,
    configureEditor: port.commands.configureEditor,
    disableEditor: messages.disableEditor,
    selectElement: port.commands.selectElement,
    clearSelection: port.commands.clearSelection,
    requestGeometry: port.commands.requestGeometry,
    startTextEdit: port.commands.startTextEdit,
    cancelTextEdit: port.commands.cancelTextEdit,
    setTool: port.commands.setTool,
    assignElementId: port.commands.assignElementId,
  }
}

export function useDeckEditorBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  options: UseDeckEditorBridgeOptions,
) {
  const runtimeHandlerRef = useRef<(data: EditorRuntimeMessage) => void>(() => undefined)
  const dispatchRuntimeMessage = useCallback((data: EditorRuntimeMessage) => {
    runtimeHandlerRef.current(data)
  }, [])
  const port = useEditorBridgePort(iframeRef, options, dispatchRuntimeMessage)
  const messages = useEditorBridgeMessages(port, options)
  useLayoutEffect(() => {
    runtimeHandlerRef.current = messages.handleRuntimeMessage
  }, [messages.handleRuntimeMessage])

  return assembleDeckEditorBridge(port, messages)
}
