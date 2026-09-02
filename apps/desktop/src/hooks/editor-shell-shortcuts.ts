import { toast } from 'sonner'

import { isEditableClipboardTarget } from '@/lib/editor/deck-image-insert'
import { isRemoteImageUrl } from '@ark/deck/document/image.ts'

export type DeckEditorShellShortcutContext = {
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
  onClearSelection?: () => void
}

export function handleEditorPaste(event: ClipboardEvent, onInsertImage: (file: File) => void) {
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
}

export function handleEditorKeyDown(event: KeyboardEvent, ctx: DeckEditorShellShortcutContext) {
  const historyModifier = event.metaKey || event.ctrlKey

  if (historyModifier && !event.altKey && (event.key === 'z' || event.key === 'Z')) {
    if (ctx.textEditActive || ctx.isTextEditSaving || isEditableClipboardTarget(event.target)) {
      return
    }

    const action = event.shiftKey
      ? ctx.canRedo
        ? ctx.onRedo
        : undefined
      : ctx.canUndo
        ? ctx.onUndo
        : undefined
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
    if (
      !ctx.textEditActive &&
      !ctx.isTextEditSaving &&
      !isEditableClipboardTarget(event.target) &&
      ctx.canRedo &&
      ctx.onRedo
    ) {
      event.preventDefault()
      ctx.onRedo()
    }
    return
  }

  if (event.key === 'Escape') {
    if (ctx.textEditActive) {
      event.preventDefault()
      ctx.onEndTextEditing()
    } else if (ctx.activeTool !== 'select') {
      event.preventDefault()
      ctx.onSelectTool()
    } else {
      ctx.onClearSelection?.()
    }
    return
  }

  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    ctx.textEditActive ||
    !ctx.canEditSelectedText ||
    (event.target instanceof HTMLElement && event.target.closest('button, [role="button"]'))
  ) {
    return
  }

  event.preventDefault()
  ctx.onBeginTextEdit()
}

export function handleEditorHistoryAction(
  action: 'undo' | 'redo',
  active: boolean,
  ctx: Pick<
    DeckEditorShellShortcutContext,
    'textEditActive' | 'isTextEditSaving' | 'canUndo' | 'canRedo' | 'onUndo' | 'onRedo'
  >,
) {
  if (
    !active ||
    ctx.textEditActive ||
    ctx.isTextEditSaving ||
    isEditableClipboardTarget(document.activeElement)
  ) {
    return
  }
  if (action === 'undo' && ctx.canUndo && ctx.onUndo) ctx.onUndo()
  if (action === 'redo' && ctx.canRedo && ctx.onRedo) ctx.onRedo()
}
