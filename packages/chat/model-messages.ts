import type { FilePart, ModelMessage, TextPart } from 'ai'

import { parseAssetIdFromUrl } from '@ark/deck/document/assets.ts'
import { deckOriginIsUnauthored, type DeckOrigin } from '@ark/deck/document/origin.ts'
import { formatDeckThemeSummary } from '@ark/deck/document/theme.ts'

import type { ApiChatMessage } from './api-projection.ts'
import {
  collectAssetIds,
  decodeDataUrlText,
  isReadableTextMediaType,
  MAX_INLINE_TEXT_ATTACHMENT_CHARS,
  type ChatAttachment,
} from './attachments.ts'
import {
  describeEditorSelectionLine,
  describeOneSlideContext,
  normalizeEditorSelectionFields,
  type EditorSelectionContext,
  type SlideContext,
  type ThemeSelectionContext,
} from './context.ts'
import type { ChatMessageRole } from './messages.ts'

const PROVIDER_SAFE_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

function formatInlineTextAttachmentPart(attachment: ChatAttachment): TextPart {
  const label = attachment.filename ? `"${attachment.filename}"` : 'attachment'
  const header = `Attached file ${label} (${attachment.mediaType}):`
  const decoded = decodeDataUrlText(attachment.url)

  if (decoded === null) {
    return {
      type: 'text',
      text: `${header}\n[Could not decode attachment contents.]`,
    }
  }

  if (decoded.length <= MAX_INLINE_TEXT_ATTACHMENT_CHARS) {
    return { type: 'text', text: `${header}\n${decoded}` }
  }

  const truncated = decoded.slice(0, MAX_INLINE_TEXT_ATTACHMENT_CHARS)
  return {
    type: 'text',
    text: `${header}\n${truncated}\n\n[Truncated: showing first ${MAX_INLINE_TEXT_ATTACHMENT_CHARS} characters of ${decoded.length}.]`,
  }
}

/**
 * Convert inline attachments into model content parts.
 *
 * Readable text (CSV, plain text, Markdown, JSON) becomes TextParts so OpenAI
 * and Claude do not reject unsupported file media types. Images/PDFs remain
 * FileParts. Ark asset references are skipped — the server resolves them (or
 * exposes them via read_attachment) before this runs.
 */
export function chatAttachmentsToModelParts(
  attachments: ChatAttachment[],
): Array<TextPart | FilePart> {
  const parts: Array<TextPart | FilePart> = []

  for (const attachment of attachments) {
    if (!attachment.url.startsWith('data:')) {
      continue
    }

    if (isReadableTextMediaType(attachment.mediaType)) {
      parts.push(formatInlineTextAttachmentPart(attachment))
      continue
    }

    const normalized = attachment.mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
    if (normalized.startsWith('image/') && !PROVIDER_SAFE_IMAGE_MEDIA_TYPES.has(normalized)) {
      const label = attachment.filename ? `"${attachment.filename}"` : 'the attached image'
      parts.push({
        type: 'text',
        text: `Attached image ${label} (${attachment.mediaType}) is available through list_attachments for placement, but this provider may not support visual preview of its format.`,
      })
      continue
    }

    parts.push({
      type: 'file',
      mediaType: attachment.mediaType,
      data: attachment.url,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    })
  }

  return parts
}

export function wrapUserPromptForGeneration(prompt: string, currentHtml: string) {
  if (currentHtml.trim()) {
    return `The user wants to revise the existing Ark HTML deck.

User instruction:
${prompt}

Current full HTML deck:
${currentHtml}

Return the complete revised HTML document only.`
  }

  return `Create a new complete Ark HTML slide deck from this user request:

${prompt}

Return the complete HTML document only.`
}

function describeEditorSelection(selection: EditorSelectionContext): string {
  const lockGuidance = selection.locked
    ? ' Because it is locked, explain what can and cannot be changed or make a safe patch instead of forcing a risky edit.'
    : ''

  return `The user has an element selected in the editor. When the instruction refers to "this", "it", or "the selected element", target it.
Selected element: ${describeEditorSelectionLine(selection)}
Verify it with parse_deck or read_deck, then prefer patch_element with this elementId. If the id is missing or no longer matches (stale selection), inspect the deck and pick the closest element or ask before guessing.${lockGuidance}`
}

/** Prompt note for one or more editor selections. Lists every id; never summarizes them away. */
export function describeEditorSelections(
  selections: EditorSelectionContext[],
  primary?: EditorSelectionContext,
): string {
  if (selections.length === 0) {
    return ''
  }

  if (selections.length === 1) {
    return describeEditorSelection(selections[0]!)
  }

  const resolvedPrimary =
    primary && selections.some((item) => item.elementId === primary.elementId)
      ? primary
      : selections[selections.length - 1]!
  const listed = selections.map((item) => `- ${describeEditorSelectionLine(item)}`).join('\n')
  const anyLocked = selections.some((item) => item.locked)
  const lockGuidance = anyLocked
    ? ' Because some selected elements are locked, explain what can and cannot be changed or make a safe patch instead of forcing a risky edit.'
    : ''

  return `The user has ${selections.length} elements selected in the editor. When the instruction refers to "these", "them", or "the selected elements", target this set. The primary / last-interacted element is id "${resolvedPrimary.elementId}".
Selected elements:
${listed}
Verify each with parse_deck or read_deck, then prefer patch_element per elementId. Apply the requested change to every selected id unless the instruction names a subset. If an id is missing or no longer matches (stale selection), skip it and mention that in the reply instead of guessing.${lockGuidance}`
}

/** Prompt note for slides the user attached as chat context. */
export function describeSlideContexts(slides: SlideContext[]): string {
  if (slides.length === 0) {
    return ''
  }

  const listed = slides.map(describeOneSlideContext).join('; ')
  const focus =
    slides.length === 1
      ? `Focus reads and edits on that slide; use read_deck / patch_deck with slide index ${slides[0]!.slideIndex}.`
      : `Focus reads and edits on those slides; use read_deck / patch_deck with the listed slide indexes.`

  return `The user attached the following slide(s) as context: ${listed}.
When the instruction refers to "this slide", "these slides", or attached slide context, target them.
${focus}`
}

function describeThemeSelection(selection: ThemeSelectionContext) {
  return `The user selected a visual theme. Use this exact contract for the deck: name "${selection.name}" (id: ${selection.themeId}, signature ${selection.theme.signature}).
${formatDeckThemeSummary(selection.theme)}
Embed this spec as <script type="application/json" data-ark-theme>, materialize its --ark-* CSS variables, set data-ark-font-* markers, and classify every slide with data-ark-slide-kind and data-ark-layout matching the recipes. Do not invent a different palette or layout system.`
}

export function wrapUserPromptForAgent(
  prompt: string,
  currentHtml: string,
  attachmentCount = 0,
  editorSelection?: EditorSelectionContext,
  slideContexts?: SlideContext[],
  deckOrigin?: DeckOrigin | null,
  editorSelections?: EditorSelectionContext[],
  themeSelection?: ThemeSelectionContext,
) {
  const effectivePrompt =
    prompt.trim() ||
    (attachmentCount > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

  const attachmentNote =
    attachmentCount > 0
      ? `\n\nThe user attached ${attachmentCount} file(s). Use them as reference for content, layout, branding, or visuals.`
      : ''

  const normalized = normalizeEditorSelectionFields({ editorSelection, editorSelections })
  const selectionNote = normalized.editorSelections?.length
    ? `\n\n${describeEditorSelections(normalized.editorSelections, normalized.editorSelection)}`
    : ''
  const slideNote =
    slideContexts && slideContexts.length > 0 ? `\n\n${describeSlideContexts(slideContexts)}` : ''
  const themeNote = themeSelection ? `\n\n${describeThemeSelection(themeSelection)}` : ''

  // Ark creates the deck before the first message, so a blank starter deck has
  // HTML but nothing authored. Treat it as a new deck, not something to revise.
  if (currentHtml.trim() && !deckOriginIsUnauthored(deckOrigin)) {
    return `The user wants to revise their Ark HTML deck.

User instruction:
${effectivePrompt}${attachmentNote}${selectionNote}${slideNote}${themeNote}

The current deck is available in the job workspace. Inspect it with the available tools before editing.`
  }

  const blankDeckNote = currentHtml.trim()
    ? '\n\nThe workspace holds an empty starter deck with no authored content. Do not read or preserve it; write_deck replaces it outright.'
    : ''

  return `Create a new complete Ark HTML slide deck from this user request:

${effectivePrompt}${attachmentNote}${blankDeckNote}${themeNote}

Use the available tools to save the deck, then summarize what you built.`
}

export function buildUserModelContent(
  message: ApiChatMessage,
  options?: {
    wrapForAgent?: boolean
    currentHtml?: string
    editorSelection?: EditorSelectionContext
    editorSelections?: EditorSelectionContext[]
    slideContexts?: SlideContext[]
    deckOrigin?: DeckOrigin | null
    themeSelection?: ThemeSelectionContext
  },
): string | Array<TextPart | FilePart> {
  const attachments = message.attachments ?? []
  const wrapForAgent = options?.wrapForAgent ?? false
  const currentHtml = options?.currentHtml ?? ''
  const prompt =
    wrapForAgent && message.role === 'user'
      ? wrapUserPromptForAgent(
          message.content,
          currentHtml,
          attachments.length,
          options?.editorSelection,
          options?.slideContexts,
          options?.deckOrigin,
          options?.editorSelections,
          options?.themeSelection ?? message.context?.themeSelection,
        )
      : message.content

  if (attachments.length === 0) {
    return prompt
  }

  return [...chatAttachmentsToModelParts(attachments), { type: 'text', text: prompt }]
}

export function toModelMessage(message: ApiChatMessage): ModelMessage {
  if (message.role === 'assistant') {
    return { role: 'assistant', content: message.content }
  }

  return {
    role: 'user',
    content: buildUserModelContent(message),
  }
}

export function buildModelMessages(
  messages: ApiChatMessage[],
  currentHtml: string,
): Array<{ role: ChatMessageRole; content: string }> {
  if (messages.length === 0) {
    return []
  }

  const prior = messages.slice(0, -1).map((message) => ({
    role: message.role,
    content: message.content,
  }))

  const last = messages[messages.length - 1]
  if (last.role !== 'user') {
    return prior
  }

  return [
    ...prior,
    {
      role: 'user' as const,
      content: wrapUserPromptForGeneration(last.content, currentHtml),
    },
  ]
}

/** Collect unique Ark asset ids referenced by user messages in chat history. */
export function collectAssetIdsFromMessages(messages: readonly ApiChatMessage[]): string[] {
  const ids = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }

    for (const id of collectAssetIds(message.attachments)) {
      ids.add(id)
    }
  }

  return [...ids]
}

/**
 * Swap lightweight Ark asset references for resolved inline attachments. Used
 * when building model input so prior turns keep their file context without
 * storing bytes in persisted chat history.
 */
export function applyResolvedAssetAttachments(
  messages: readonly ApiChatMessage[],
  resolvedById: ReadonlyMap<string, ChatAttachment>,
): ApiChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !message.attachments?.length) {
      return message
    }

    const attachments = message.attachments.map((attachment) => {
      if (attachment.url.startsWith('data:')) {
        return attachment
      }

      const assetId = attachment.assetId ?? parseAssetIdFromUrl(attachment.url)

      if (!assetId) {
        return attachment
      }

      return resolvedById.get(assetId) ?? attachment
    })

    return { ...message, attachments }
  })
}
