import { useEffect, useEffectEvent } from 'react'

import {
  handleEditorHistoryAction,
  handleEditorKeyDown,
  handleEditorPaste,
  type DeckEditorShellShortcutContext,
} from './editor-shell-shortcuts.ts'

type DeckEditorShellShortcutsOptions = DeckEditorShellShortcutContext & {
  active: boolean
}

export function useDeckEditorShellShortcuts({
  active,
  textEditActive,
  isTextEditSaving,
  activeTool,
  canEditSelectedText,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onEndTextEditing,
  onSelectTool,
  onBeginTextEdit,
  onInsertImage,
  onClearSelection,
}: DeckEditorShellShortcutsOptions) {
  const ctx: DeckEditorShellShortcutContext = {
    textEditActive,
    isTextEditSaving,
    activeTool,
    canEditSelectedText,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onEndTextEditing,
    onSelectTool,
    onBeginTextEdit,
    onInsertImage,
    onClearSelection,
  }

  const handlePaste = useEffectEvent((event: ClipboardEvent) => {
    handleEditorPaste(event, onInsertImage)
  })

  useEffect(() => {
    if (!active || textEditActive) {
      return
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [active, textEditActive])

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    handleEditorKeyDown(event, ctx)
  })

  useEffect(() => {
    if (!active) {
      return
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  const onHistoryAction = useEffectEvent((action: 'undo' | 'redo') => {
    handleEditorHistoryAction(action, active, ctx)
  })

  useEffect(() => {
    return window.arkDesktop?.edit?.onHistoryAction(onHistoryAction)
  }, [])

  useEffect(() => {
    const historyEnabled = active && !textEditActive && !isTextEditSaving
    window.arkDesktop?.edit?.setHistoryState({
      canUndo: historyEnabled && canUndo,
      canRedo: historyEnabled && canRedo,
    })
    return () => {
      window.arkDesktop?.edit?.setHistoryState({ canUndo: false, canRedo: false })
    }
  }, [active, canRedo, canUndo, isTextEditSaving, textEditActive])
}
