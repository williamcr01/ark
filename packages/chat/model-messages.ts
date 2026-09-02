import type { FilePart, ModelMessage, TextPart } from 'ai'

import { parseAssetIdFromUrl } from '@ark/deck/document/assets.ts'
import type { DeckOrigin } from '@ark/deck/document/origin.ts'

import type { ApiChatMessage } from './api-projection.ts'
import {
  collectAssetIds,
  decodeDataUrlText,
  isReadableTextMediaType,
  MAX_INLINE_TEXT_ATTACHMENT_CHARS,
  type ChatAttachment,
} from './attachments.ts'
import type { EditorSelectionContext, SlideContext, ThemeSelectionContext } from './context.ts'

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

export type WrapUserPrompt = (
  prompt: string,
  currentHtml: string,
  attachmentCount?: number,
  editorSelection?: EditorSelectionContext,
  slideContexts?: SlideContext[],
  deckOrigin?: DeckOrigin | null,
  editorSelections?: EditorSelectionContext[],
  themeSelection?: ThemeSelectionContext,
) => string

export function buildUserModelContent(
  message: ApiChatMessage,
  options?: {
    wrapUserPrompt?: WrapUserPrompt
    currentHtml?: string
    editorSelection?: EditorSelectionContext
    editorSelections?: EditorSelectionContext[]
    slideContexts?: SlideContext[]
    deckOrigin?: DeckOrigin | null
    themeSelection?: ThemeSelectionContext
  },
): string | Array<TextPart | FilePart> {
  const attachments = message.attachments ?? []
  const currentHtml = options?.currentHtml ?? ''
  const prompt =
    options?.wrapUserPrompt && message.role === 'user'
      ? options.wrapUserPrompt(
          message.content,
          currentHtml,
          attachments.length,
          options.editorSelection,
          options.slideContexts,
          options.deckOrigin,
          options.editorSelections,
          options.themeSelection ?? message.context?.themeSelection,
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
