import type { FilePart, ModelMessage, TextPart } from 'ai'

export type ChatMessageRole = 'user' | 'assistant'

/** Serializable file attachment sent with a user message. */
export type ChatAttachment = {
  type: 'file'
  mediaType: string
  filename?: string
  url: string
}

export const MAX_CHAT_ATTACHMENTS = 5
export const MAX_CHAT_ATTACHMENT_BYTES = 2 * 1024 * 1024

export type AgentStepType = 'text' | 'tool-call' | 'tool-result'

/** One visible agent loop event (tool call, result, or assistant text chunk). */
export type AgentStep = {
  type: AgentStepType
  toolName?: string
  summary: string
  error?: boolean
}

/** Rich assistant turn content persisted in chat history. */
export type ChatMessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool-call'; toolName: string; summary: string }
  | { type: 'tool-result'; toolName: string; summary: string; error?: boolean }

/** Client-side chat message with a stable id for React keys. */
export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
}

/** API payload message (ids are optional and ignored server-side). */
export type ApiChatMessage = {
  id?: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
}

/**
 * Context policy (pi-style): every generation request replays the full visible
 * conversation plus the latest deck HTML. Assistant turns store short status
 * text only — never full HTML — so follow-ups stay affordable while intent is
 * preserved across turns.
 */
export const CHAT_CONTEXT_POLICY = {
  replayFullHistory: true,
  includeCurrentHtml: true,
  assistantMessagesExcludeHtml: true,
} as const

export type ParseGenerateMessagesResult =
  { ok: true; messages: ApiChatMessage[] } | { ok: false; error: string }

const isChatMessageRole = (value: unknown): value is ChatMessageRole =>
  value === 'user' || value === 'assistant'

const estimateDataUrlBytes = (url: string) => {
  const commaIndex = url.indexOf(',')
  if (commaIndex === -1) {
    return url.length
  }

  const payload = url.slice(commaIndex + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

const parseChatAttachments = (
  input: unknown,
  messageIndex: number,
): { ok: true; attachments: ChatAttachment[] } | { ok: false; error: string } => {
  if (input === undefined) {
    return { ok: true, attachments: [] }
  }

  if (!Array.isArray(input)) {
    return { ok: false, error: `messages[${messageIndex}].attachments must be an array.` }
  }

  if (input.length > MAX_CHAT_ATTACHMENTS) {
    return {
      ok: false,
      error: `messages[${messageIndex}] has too many attachments (max ${MAX_CHAT_ATTACHMENTS}).`,
    }
  }

  const attachments: ChatAttachment[] = []

  for (const [attachmentIndex, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}] must be an object.`,
      }
    }

    const type = (item as { type?: unknown }).type
    if (type !== 'file') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].type must be "file".`,
      }
    }

    const mediaType = (item as { mediaType?: unknown }).mediaType
    if (typeof mediaType !== 'string' || mediaType.trim().length === 0) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].mediaType must be a string.`,
      }
    }

    const url = (item as { url?: unknown }).url
    if (typeof url !== 'string' || !url.startsWith('data:')) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].url must be a data URL.`,
      }
    }

    const filename = (item as { filename?: unknown }).filename
    if (filename !== undefined && typeof filename !== 'string') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].filename must be a string.`,
      }
    }

    const estimatedBytes = estimateDataUrlBytes(url)
    if (estimatedBytes > MAX_CHAT_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}] exceeds the ${MAX_CHAT_ATTACHMENT_BYTES} byte limit.`,
      }
    }

    attachments.push({
      type: 'file',
      mediaType: mediaType.trim(),
      url,
      ...(typeof filename === 'string' && filename.trim().length > 0
        ? { filename: filename.trim() }
        : {}),
    })
  }

  return { ok: true, attachments }
}

/** Runtime validation for untrusted generation job request bodies. */
export function parseGenerateMessages(input: unknown): ParseGenerateMessagesResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'messages must be an array.' }
  }

  const messages: ApiChatMessage[] = []

  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `messages[${index}] must be an object.` }
    }

    const role = (item as { role?: unknown }).role
    if (!isChatMessageRole(role)) {
      return {
        ok: false,
        error: `messages[${index}].role must be "user" or "assistant".`,
      }
    }

    const content = (item as { content?: unknown }).content
    if (typeof content !== 'string') {
      return {
        ok: false,
        error: `messages[${index}].content must be a string.`,
      }
    }

    const parsedAttachments = parseChatAttachments(
      (item as { attachments?: unknown }).attachments,
      index,
    )
    if (!parsedAttachments.ok) {
      return parsedAttachments
    }

    const trimmed = content.trim()
    if (trimmed.length > 0 || parsedAttachments.attachments.length > 0) {
      messages.push({
        role,
        content: trimmed,
        ...(parsedAttachments.attachments.length > 0
          ? { attachments: parsedAttachments.attachments }
          : {}),
      })
    }
  }

  return { ok: true, messages }
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

export function wrapUserPromptForAgent(prompt: string, currentHtml: string, attachmentCount = 0) {
  const effectivePrompt =
    prompt.trim() ||
    (attachmentCount > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

  const attachmentNote =
    attachmentCount > 0
      ? `\n\nThe user attached ${attachmentCount} file(s). Use them as reference for content, layout, branding, or visuals.`
      : ''

  if (currentHtml.trim()) {
    return `The user wants to revise their Ark HTML deck.

User instruction:
${effectivePrompt}${attachmentNote}

Use parse_deck, list_slides, and/or read_deck to inspect the deck. Apply changes with edit_deck (preferred) or write_deck only for a full rewrite.`
  }

  return `Create a new complete Ark HTML slide deck from this user request:

${effectivePrompt}${attachmentNote}

Use write_deck to save the complete HTML document, then summarize what you built.`
}

export function chatAttachmentsToFileParts(attachments: ChatAttachment[]): FilePart[] {
  return attachments.map((attachment) => ({
    type: 'file',
    mediaType: attachment.mediaType,
    data: attachment.url,
    ...(attachment.filename ? { filename: attachment.filename } : {}),
  }))
}

export function buildUserModelContent(
  message: ApiChatMessage,
  options?: { wrapForAgent?: boolean; currentHtml?: string },
): string | Array<TextPart | FilePart> {
  const attachments = message.attachments ?? []
  const wrapForAgent = options?.wrapForAgent ?? false
  const currentHtml = options?.currentHtml ?? ''
  const prompt =
    wrapForAgent && message.role === 'user'
      ? wrapUserPromptForAgent(message.content, currentHtml, attachments.length)
      : message.content

  if (attachments.length === 0) {
    return prompt
  }

  return [...chatAttachmentsToFileParts(attachments), { type: 'text', text: prompt }]
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

export function buildAgentModelMessages(
  messages: ApiChatMessage[],
  currentHtml: string,
): ModelMessage[] {
  if (messages.length === 0) {
    return []
  }

  const prior = messages.slice(0, -1).map(toModelMessage)
  const last = messages[messages.length - 1]

  if (last.role !== 'user') {
    return prior
  }

  return [
    ...prior,
    {
      role: 'user' as const,
      content: buildUserModelContent(last, { wrapForAgent: true, currentHtml }),
    },
  ]
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

export function toApiMessages(messages: ChatMessage[]): ApiChatMessage[] {
  return messages.map(({ role, content, attachments }) => ({
    role,
    content,
    ...(attachments?.length ? { attachments } : {}),
  }))
}

export function toChatAttachments(
  files: Array<{ mediaType: string; filename?: string; url: string }>,
): ChatAttachment[] {
  return files.map((file) => ({
    type: 'file',
    mediaType: file.mediaType,
    url: file.url,
    ...(file.filename ? { filename: file.filename } : {}),
  }))
}

export function agentStepsToChatParts(steps: AgentStep[]): ChatMessagePart[] {
  const parts: ChatMessagePart[] = []

  for (const step of steps) {
    if (step.type === 'text') {
      parts.push({ type: 'text', content: step.summary })
      continue
    }

    if (step.type === 'tool-call') {
      parts.push({
        type: 'tool-call',
        toolName: step.toolName ?? 'tool',
        summary: step.summary,
      })
      continue
    }

    parts.push({
      type: 'tool-result',
      toolName: step.toolName ?? 'tool',
      summary: step.summary,
      error: step.error,
    })
  }

  return parts
}

export function buildAssistantMessageContent(
  assistantText: string,
  steps: AgentStep[],
  editingExistingDeck: boolean,
) {
  const trimmed = assistantText.trim()

  if (trimmed) {
    return trimmed
  }

  const lastResult = [...steps].reverse().find((step) => step.type === 'tool-result' && !step.error)

  if (lastResult) {
    return lastResult.summary
  }

  return editingExistingDeck
    ? 'Updated the deck using tool calls.'
    : 'Generated the deck using tool calls.'
}
