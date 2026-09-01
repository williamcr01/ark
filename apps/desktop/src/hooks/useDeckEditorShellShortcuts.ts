import { useEffect, useEffectEvent } from 'react'
import { toast } from 'sonner'

import { isEditableClipboardTarget } from '@/lib/editor/deck-image-insert'
import { isRemoteImageUrl } from '@ark/deck/document/image.ts'

type DeckEditorShellShortcutsOptions = {
  active: boolean
  textEditActive: boolean
  isTextEditSaving: boolean
  activeTool: string
  canEditSelectedText: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo?: () => void
  onRedo?: () => void
  onEndTextEditing: () => void
  onSelectTool: () => void
  onBeginTextEdit: () => void
  onInsertImage: (file: File) => void
  /** Clear the canvas selection set (Escape while the select tool is active). */
  onClearSelection?: () => void
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
  const handlePaste = useEffectEvent((event: ClipboardEvent) => {
    if (isEditableClipboardTarget(event.target)) {
      return
    }

    const clipboard = event.clipboardData
    if (!clipboard) {
      return
    }

    for (const item of clipboard.items) {
      if (!item.type.startsWith('image/')) {
        continue
      }

      const file = item.getAsFile()
      if (!file) {
        continue
      }

      event.preventDefault()
      onInsertImage(file)
      return
    }

    const pastedText = clipboard.getData('text/plain').trim()
    if (pastedText && isRemoteImageUrl(pastedText)) {
      event.preventDefault()
      toast.error(
        'Remote image URLs cannot be inserted directly. Use a local file or paste image data.',
      )
    }
  })

  useEffect(() => {
    if (!active || textEditActive) {
      return
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [active, textEditActive])

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const historyModifier = event.metaKey || event.ctrlKey

    if (historyModifier && !event.altKey && (event.key === 'z' || event.key === 'Z')) {
      if (textEditActive || isTextEditSaving) {
        return
      }

      const action = event.shiftKey ? (canRedo ? onRedo : undefined) : canUndo ? onUndo : undefined
      if (action) {
        event.preventDefault()
        action()
      }
      return
    }

    if (
      historyModifier &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === 'y' || event.key === 'Y')
    ) {
      if (!textEditActive && !isTextEditSaving && canRedo && onRedo) {
        event.preventDefault()
        onRedo()
      }
      return
    }

    if (event.key === 'Escape') {
      if (textEditActive) {
        event.preventDefault()
        onEndTextEditing()
      } else if (activeTool !== 'select') {
        event.preventDefault()
        onSelectTool()
      } else {
        onClearSelection?.()
      }
      return
    }

    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      textEditActive ||
      !canEditSelectedText ||
      (event.target instanceof HTMLElement && event.target.closest('button, [role="button"]'))
    ) {
      return
    }

    event.preventDefault()
    onBeginTextEdit()
  })

  useEffect(() => {
    if (!active) {
      return
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active])
}
