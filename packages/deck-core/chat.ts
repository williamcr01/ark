import type { FilePart, ModelMessage, TextPart } from 'ai'

import { isValidAssetId, parseAssetIdFromUrl } from './assets.ts'

export type ChatMessageRole = 'user' | 'assistant'

/**
 * Serializable file attachment sent with a user message.
 *
 * Two shapes are supported:
 * - Inline data URL (`url` starts with `data:`) — bytes travel with the message.
 * - Ark asset reference (`assetId` set, `url` is a deck-scoped `/api/decks/:deckId/assets/:id`
 *   URL) — the persisted message stays lightweight and the server resolves the
 *   bytes from asset storage when needed for generation.
 */
export type ChatAttachment = {
  type: 'file'
  mediaType: string
  filename?: string
  url: string
  assetId?: string
}

export const MAX_CHAT_ATTACHMENTS = 5
export const MAX_CHAT_ATTACHMENT_BYTES = 2 * 1024 * 1024

const CHAT_MESSAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidChatMessageId(id: string) {
  return CHAT_MESSAGE_ID_PATTERN.test(id)
}

export type AgentStepType = 'text' | 'tool-call' | 'tool-result'

/** One visible agent loop event (tool call, result, or assistant text chunk). */
export type AgentStep = {
  type: AgentStepType
  toolName?: string
  summary: string
  error?: boolean
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const MAX_PERSISTED_TOOL_VALUE_BYTES = 50 * 1024
export const MAX_PERSISTED_ASSISTANT_TURN_BYTES = 512 * 1024
export const MAX_MODEL_ASSISTANT_TURN_BYTES = 96 * 1024

/** Rich assistant turn content persisted in chat history. */
export type ChatMessagePart =
  | { type: 'text'; content: string; stepIndex?: number }
  | {
      type: 'tool-call'
      toolName: string
      summary: string
      stepIndex?: number
      toolCallId?: string
      input?: JsonValue
    }
  | {
      type: 'tool-result'
      toolName: string
      summary: string
      error?: boolean
      stepIndex?: number
      toolCallId?: string
      output?: JsonValue
      isError?: boolean
    }

/** Client-side chat message with a stable id for React keys. */
export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
}

/** API payload message (optional client ids enable server-side deduplication). */
export type ApiChatMessage = {
  id?: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
}

/**
 * Manual-editor selection forwarded with a generation request (issue #83). Lets
 * the agent resolve "this"/"the selected element" to a concrete element id and
 * prefer id-based patches over full-document rewrites.
 */
export type EditorSelectionContext = {
  slideIndex: number
  slideId?: string
  elementId: string
  elementKind?: string
  elementRole?: string
  textPreview?: string
  locked?: boolean
  managed?: boolean
}

/**
 * Context policy (pi-style): every generation request replays the full visible
 * conversation. Durable assistant turns retain every logical step using bounded,
 * recoverable tool projections. Model context is assembled separately and may
 * summarize older steps without mutating persisted chat.
 * The AI SDK owns tool-result continuation within a single generation job.
 * Compaction, branch summaries, steer queues, and follow-up queues are not implemented.
 */
export const CHAT_CONTEXT_POLICY = {
  replayFullHistory: true,
  includeCurrentHtml: true,
  assistantMessagesExcludeHtml: true,
  replayAssistantToolTranscript: true,
} as const

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

function parseChatMessageParts(input: unknown, messageIndex: number) {
  if (input === undefined) return { ok: true as const, parts: undefined }
  if (!Array.isArray(input)) {
    return { ok: false as const, error: `messages[${messageIndex}].parts must be an array.` }
  }
  const parts: ChatMessagePart[] = []
  let totalCharacters = 0
  for (const [partIndex, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false as const,
        error: `messages[${messageIndex}].parts[${partIndex}] must be an object.`,
      }
    }
    const part = raw as Record<string, unknown>
    const stepIndex = part.stepIndex
    if (stepIndex !== undefined && (!Number.isInteger(stepIndex) || (stepIndex as number) < 0)) {
      return {
        ok: false as const,
        error: `messages[${messageIndex}].parts[${partIndex}].stepIndex must be a non-negative integer.`,
      }
    }
    if (part.type === 'text' && typeof part.content === 'string') {
      parts.push({
        type: 'text',
        content: part.content,
        ...(stepIndex !== undefined ? { stepIndex: stepIndex as number } : {}),
      })
      continue
    }
    if (
      (part.type === 'tool-call' || part.type === 'tool-result') &&
      typeof part.toolName === 'string' &&
      typeof part.summary === 'string'
    ) {
      const valueKey = part.type === 'tool-call' ? 'input' : 'output'
      if (part[valueKey] !== undefined && !isJsonValue(part[valueKey])) {
        return {
          ok: false as const,
          error: `messages[${messageIndex}].parts[${partIndex}].${valueKey} must be JSON-safe.`,
        }
      }
      if (
        part[valueKey] !== undefined &&
        jsonBytes(part[valueKey]) > MAX_PERSISTED_TOOL_VALUE_BYTES
      ) {
        return {
          ok: false as const,
          error: `messages[${messageIndex}].parts[${partIndex}].${valueKey} exceeds the ${MAX_PERSISTED_TOOL_VALUE_BYTES} byte persistence limit.`,
        }
      }
      const common = {
        toolName: part.toolName,
        summary: part.summary,
        ...(stepIndex !== undefined ? { stepIndex: stepIndex as number } : {}),
        ...(typeof part.toolCallId === 'string' ? { toolCallId: part.toolCallId } : {}),
      }
      if (part.type === 'tool-call')
        parts.push({
          type: 'tool-call',
          ...common,
          ...(part.input !== undefined ? { input: part.input as JsonValue } : {}),
        })
      else
        parts.push({
          type: 'tool-result',
          ...common,
          ...(typeof part.error === 'boolean' ? { error: part.error } : {}),
          ...(part.output !== undefined ? { output: part.output as JsonValue } : {}),
          ...(typeof part.isError === 'boolean' ? { isError: part.isError } : {}),
        })
      continue
    }
    return {
      ok: false as const,
      error: `messages[${messageIndex}].parts[${partIndex}] is invalid.`,
    }
  }
  for (const part of parts) totalCharacters += jsonBytes(part)
  if (totalCharacters > MAX_PERSISTED_ASSISTANT_TURN_BYTES) {
    return {
      ok: false as const,
      error: `messages[${messageIndex}].parts exceeds the ${MAX_PERSISTED_ASSISTANT_TURN_BYTES} byte persistence limit.`,
    }
  }
  return { ok: true as const, parts }
}

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

export const parseChatAttachments = (
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
    const rawAssetId = (item as { assetId?: unknown }).assetId

    if (
      rawAssetId !== undefined &&
      (typeof rawAssetId !== 'string' || !isValidAssetId(rawAssetId))
    ) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].assetId must be a valid asset id.`,
      }
    }

    if (typeof url !== 'string') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].url must be a string.`,
      }
    }

    const assetId =
      typeof rawAssetId === 'string' ? rawAssetId : (parseAssetIdFromUrl(url) ?? undefined)
    const isDataUrl = url.startsWith('data:')

    // Accept either an inline data URL or an Ark-owned asset reference. External
    // http(s) URLs are never allowed to keep preview/export network-isolated.
    if (!isDataUrl && !assetId) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].url must be a data URL or Ark asset reference.`,
      }
    }

    const filename = (item as { filename?: unknown }).filename
    if (filename !== undefined && typeof filename !== 'string') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].filename must be a string.`,
      }
    }

    if (isDataUrl) {
      const estimatedBytes = estimateDataUrlBytes(url)
      if (estimatedBytes > MAX_CHAT_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `messages[${messageIndex}].attachments[${attachmentIndex}] exceeds the ${MAX_CHAT_ATTACHMENT_BYTES} byte limit.`,
        }
      }
    }

    attachments.push({
      type: 'file',
      mediaType: mediaType.trim(),
      url,
      ...(assetId ? { assetId } : {}),
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

    if (role === 'user' && (item as { parts?: unknown }).parts !== undefined) {
      return {
        ok: false,
        error: `messages[${index}].parts is only allowed for assistant messages.`,
      }
    }
    const parsedParts = parseChatMessageParts((item as { parts?: unknown }).parts, index)
    if (!parsedParts.ok) return parsedParts

    const rawId = (item as { id?: unknown }).id
    const id =
      typeof rawId === 'string' && isValidChatMessageId(rawId.trim()) ? rawId.trim() : undefined

    const trimmed = content.trim()
    if (trimmed.length > 0 || parsedAttachments.attachments.length > 0) {
      messages.push({
        ...(id ? { id } : {}),
        role,
        content: trimmed,
        ...(parsedAttachments.attachments.length > 0
          ? { attachments: parsedAttachments.attachments }
          : {}),
        ...(role === 'assistant' && parsedParts.parts?.length ? { parts: parsedParts.parts } : {}),
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

function describeEditorSelection(selection: EditorSelectionContext): string {
  const descriptors: string[] = []

  if (selection.elementKind) {
    descriptors.push(selection.elementKind)
  }

  if (selection.elementRole && selection.elementRole !== selection.elementKind) {
    descriptors.push(selection.elementRole)
  }

  const descriptor = descriptors.length > 0 ? ` (${descriptors.join(', ')})` : ''
  const slideRef = selection.slideId
    ? `slide ${selection.slideIndex} (slide id "${selection.slideId}")`
    : `slide ${selection.slideIndex}`
  const textNote = selection.textPreview ? `, text: "${selection.textPreview}"` : ''

  const statuses: string[] = []
  if (selection.locked) {
    statuses.push('locked')
  }
  if (selection.managed) {
    statuses.push('Ark-managed')
  }
  const statusNote = statuses.length > 0 ? ` It is ${statuses.join(' and ')}.` : ''

  const lockGuidance = selection.locked
    ? ' Because it is locked, explain what can and cannot be changed or make a safe patch instead of forcing a risky edit.'
    : ''

  return `The user has an element selected in the editor. When the instruction refers to "this", "it", or "the selected element", target it.
Selected element: id "${selection.elementId}"${descriptor} on ${slideRef}${textNote}.${statusNote}
Verify it with parse_deck or read_deck, then prefer patch_element with this elementId. If the id is missing or no longer matches (stale selection), inspect the deck and pick the closest element or ask before guessing.${lockGuidance}`
}

export function wrapUserPromptForAgent(
  prompt: string,
  currentHtml: string,
  attachmentCount = 0,
  editorSelection?: EditorSelectionContext,
) {
  const effectivePrompt =
    prompt.trim() ||
    (attachmentCount > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

  const attachmentNote =
    attachmentCount > 0
      ? `\n\nThe user attached ${attachmentCount} file(s). Use them as reference for content, layout, branding, or visuals.`
      : ''

  const selectionNote = editorSelection ? `\n\n${describeEditorSelection(editorSelection)}` : ''

  if (currentHtml.trim()) {
    return `The user wants to revise their Ark HTML deck.

User instruction:
${effectivePrompt}${attachmentNote}${selectionNote}

The current deck is available in the job workspace. Inspect it with the available tools before editing.`
  }

  return `Create a new complete Ark HTML slide deck from this user request:

${effectivePrompt}${attachmentNote}

Use the available tools to save the deck, then summarize what you built.`
}

export function chatAttachmentsToFileParts(attachments: ChatAttachment[]): FilePart[] {
  // Only attachments that carry inline bytes (data URLs) can be sent to the
  // model directly. Ark asset references must be resolved to data URLs by the
  // server (see resolveAssetAttachments) before reaching this point.
  return attachments
    .filter((attachment) => attachment.url.startsWith('data:'))
    .map((attachment) => ({
      type: 'file',
      mediaType: attachment.mediaType,
      data: attachment.url,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    }))
}

export function buildUserModelContent(
  message: ApiChatMessage,
  options?: {
    wrapForAgent?: boolean
    currentHtml?: string
    editorSelection?: EditorSelectionContext
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
        )
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

export {
  assembleDeckAgentContext,
  buildAgentModelMessages,
  convertChatHistoryToModelMessages,
  projectAssistantTurnForModel,
} from './chat-context.ts'

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
  return messages.map(({ id, role, content, attachments, parts }) => ({
    ...(id ? { id } : {}),
    role,
    content,
    ...(attachments?.length ? { attachments } : {}),
    ...(role === 'assistant' && parts?.length ? { parts: structuredClone(parts) } : {}),
  }))
}

export function toChatAttachments(
  files: Array<{ mediaType: string; filename?: string; url: string; assetId?: string }>,
): ChatAttachment[] {
  return files.map((file) => ({
    type: 'file',
    mediaType: file.mediaType,
    url: file.url,
    ...(file.assetId ? { assetId: file.assetId } : {}),
    ...(file.filename ? { filename: file.filename } : {}),
  }))
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

/** Collect the unique Ark asset ids referenced by a set of attachments. */
export function collectAssetIds(attachments: ChatAttachment[] | undefined): string[] {
  if (!attachments?.length) {
    return []
  }

  const ids = new Set<string>()

  for (const attachment of attachments) {
    const id = attachment.assetId ?? parseAssetIdFromUrl(attachment.url)
    if (id) {
      ids.add(id)
    }
  }

  return [...ids]
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
