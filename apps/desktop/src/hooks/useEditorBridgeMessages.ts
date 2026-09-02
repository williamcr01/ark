import { useCallback, useRef, useState, type MutableRefObject } from 'react'

import type { EditorRuntimeMessage, EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import { useEditorStore } from '@/state/editor-store.ts'
import {
  INITIAL_EDITOR_BRIDGE_STATE,
  type DeckEditorBridgeState,
  type SelectionIdentity,
} from '@/lib/editor/editor-bridge-state.ts'
import { reduceEditorRuntimeMessage } from '@/lib/editor/editor-bridge-messages.ts'

import type { EditorBridgeCommands } from './useEditorBridgePort.ts'

export type UseEditorBridgeMessagesOptions = {
  iframeGenerationKey?: string
  onSelectionChange?: (
    selection: EditorSelectionInfo | null,
    selections?: EditorSelectionInfo[],
  ) => void
  onEditorError?: (message: string, code?: string) => void
}

type PortSlice = {
  commands: EditorBridgeCommands
  enabledRef: MutableRefObject<boolean>
  publishTransformPreview: (preview: DeckEditorBridgeState['transformPreview']) => void
  shouldAcceptInboundRef: MutableRefObject<(() => boolean) | undefined>
}

export function useEditorBridgeMessages(port: PortSlice, options: UseEditorBridgeMessagesOptions) {
  const { iframeGenerationKey = '', onSelectionChange, onEditorError } = options
  const [state, setState] = useState<DeckEditorBridgeState>(INITIAL_EDITOR_BRIDGE_STATE)
  const [trackedGenerationKey, setTrackedGenerationKey] = useState(iframeGenerationKey)
  const stateRef = useRef(state)
  const selectionIdentityRef = useRef<SelectionIdentity>(null)
  stateRef.current = state

  if (trackedGenerationKey !== iframeGenerationKey) {
    setTrackedGenerationKey(iframeGenerationKey)
    port.publishTransformPreview(null)
    selectionIdentityRef.current = null
    stateRef.current = INITIAL_EDITOR_BRIDGE_STATE
    setState(INITIAL_EDITOR_BRIDGE_STATE)
  }

  const handleRuntimeMessage = useCallback(
    (data: EditorRuntimeMessage) => {
      if (!port.enabledRef.current) {
        return
      }

      if (port.shouldAcceptInboundRef.current && !port.shouldAcceptInboundRef.current()) {
        return
      }

      const current = stateRef.current
      const reduced = reduceEditorRuntimeMessage(current, data, selectionIdentityRef.current)
      if (!reduced) {
        return
      }

      selectionIdentityRef.current = reduced.selectionIdentity
      if (reduced.publishPreview !== undefined) {
        port.publishTransformPreview(reduced.publishPreview)
      }
      stateRef.current = reduced.state
      setState(reduced.state)
      if (reduced.state.textEditActive !== current.textEditActive) {
        useEditorStore.getState().setTextEditActive(reduced.state.textEditActive)
      }
      if (reduced.selectionChange) {
        onSelectionChange?.(reduced.selectionChange.selection, reduced.selectionChange.selections)
      }
      if (reduced.editorError) {
        onEditorError?.(reduced.editorError.message, reduced.editorError.code)
      }
    },
    [onEditorError, onSelectionChange, port],
  )

  const enableEditor = useCallback(
    (slideIndex?: number, tool: EditorTool = 'select', scale?: number) => {
      port.publishTransformPreview(null)
      selectionIdentityRef.current = null
      setState((current) => {
        const next = {
          ...INITIAL_EDITOR_BRIDGE_STATE,
          editorError: null,
          editorReady: current.editorReady,
          lastInsertRequest: current.lastInsertRequest,
          lastDeleteRequest: current.lastDeleteRequest,
          lastShortcutRequest: current.lastShortcutRequest,
          transformCommit: current.transformCommit,
          transformCancelSequence: current.transformCancelSequence,
          lastTextCommit: current.lastTextCommit,
        }
        stateRef.current = next
        return next
      })
      onSelectionChange?.(null, [])
      return port.commands.enableEditor(slideIndex, tool, scale)
    },
    [onSelectionChange, port],
  )

  const disableEditor = useCallback(() => {
    const posted = port.commands.disableEditor()

    if (posted) {
      port.publishTransformPreview(null)
      selectionIdentityRef.current = null
      stateRef.current = INITIAL_EDITOR_BRIDGE_STATE
      setState(INITIAL_EDITOR_BRIDGE_STATE)
      useEditorStore.getState().setTextEditActive(false)
      onSelectionChange?.(null, [])
    }

    return posted
  }, [onSelectionChange, port])

  return {
    disableEditor,
    enableEditor,
    handleRuntimeMessage,
    overlay: state,
  }
}
