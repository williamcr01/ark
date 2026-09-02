import type { ChatAttachment, EditorSelectionContext, SlideContext } from '@ark/chat/chat.ts'
import type { EditorSelectionInfo } from '@ark/editor-runtime'

import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import {
  buildSlideContexts,
  resolveContextSlides,
  type ContextSlideEntry,
} from '@/lib/deck/slide-context'
import { toEditorSelectionJobFields } from '@/lib/editor/editor-selection-context'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

import { uploadPromptAttachments, type PromptSubmitMessage } from './upload-prompt-attachments'

type PromptCatalogModel = {
  id: string
  name?: string
  modelId?: string
  supportsAttachments?: boolean
}

export type SubmitPromptMessageDeps = {
  canGenerate: boolean
  catalog: PromptCatalogModel[]
  selectedModel: string
  deckId: string | null
  html: string
  ensureBlankDeck: () => Promise<string | null | undefined>
  isGenerating: boolean
  editorSelection: EditorSelectionInfo | null
  editorSelections: EditorSelectionInfo[]
  contextSlideEntries: ContextSlideEntry[]
  setAttachmentError: (message: string) => void
  setInput: (value: string) => void
  enqueue: (item: {
    text: string
    attachments: ChatAttachment[]
    assetIds: string[]
    deckId: string
    editorSelection?: EditorSelectionContext
    editorSelections?: EditorSelectionContext[]
    slideContexts?: SlideContext[]
  }) => void
  generateDeck: (
    text: string,
    attachments: ChatAttachment[],
    options: {
      assetIds: string[]
      deckId: string
      editorSelection?: EditorSelectionContext
      editorSelections?: EditorSelectionContext[]
      slideContexts?: SlideContext[]
    },
  ) => Promise<unknown>
}

export async function submitPromptMessage(
  message: PromptSubmitMessage,
  deps: SubmitPromptMessageDeps,
): Promise<void> {
  const hasAttachments = message.files.length > 0
  const hasContent = Boolean(message.text.trim() || hasAttachments)

  if (!hasContent || !deps.canGenerate) {
    return
  }

  const selectedModelInfo = deps.catalog.find((model) => model.id === deps.selectedModel)
  if (selectedModelInfo && !selectedModelInfo.supportsAttachments && hasAttachments) {
    deps.setAttachmentError(
      `${selectedModelInfo.name ?? selectedModelInfo.modelId} is text-only and does not support attachments.`,
    )
    return
  }

  const workspaceId = deps.deckId ?? (await deps.ensureBlankDeck())
  if (!workspaceId) {
    deps.setAttachmentError('Could not create a deck for this prompt.')
    return
  }

  let attachments
  try {
    attachments = await uploadPromptAttachments(workspaceId, message.files)
    deps.setAttachmentError('')
  } catch (uploadError) {
    deps.setAttachmentError(
      uploadError instanceof Error ? uploadError.message : 'Could not upload the attachment.',
    )
    return
  }

  deps.setInput('')
  const assetIds = [...new Set(attachments.flatMap((item) => (item.assetId ? [item.assetId] : [])))]
  const selectionFields = toEditorSelectionJobFields(deps.editorSelection, deps.editorSelections)
  const analysis = analyzeDeckInBrowser(deps.html, {
    assetOrigin: resolveAppOrigin(),
    deckId: workspaceId,
  })
  const resolvedContextSlides = resolveContextSlides(deps.contextSlideEntries, analysis.slides)
  const slideContexts =
    resolvedContextSlides.length > 0
      ? buildSlideContexts(resolvedContextSlides, analysis.slides)
      : undefined
  const jobOptions = {
    assetIds,
    deckId: workspaceId,
    ...selectionFields,
    ...(slideContexts?.length ? { slideContexts } : {}),
  }

  if (deps.isGenerating) {
    deps.enqueue({
      text: message.text,
      attachments,
      assetIds,
      deckId: workspaceId,
      ...selectionFields,
      ...(slideContexts?.length ? { slideContexts } : {}),
    })
    return
  }

  await deps.generateDeck(message.text, attachments, jobOptions)
}
