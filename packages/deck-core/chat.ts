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

export const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

const CHAT_MESSAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidChatMessageId(id: string) {
  return CHAT_MESSAGE_ID_PATTERN.test(id)
}

export type AgentStepType = 'text' | 'thinking' | 'tool-call' | 'tool-result'

/** One visible agent loop event (tool call, result, thinking, or assistant text chunk). */
export type AgentStep = {
  type: AgentStepType
  toolName?: string
  summary: string
  error?: boolean
  /** Wall-clock duration for a finished thinking period (UI label only). */
  durationMs?: number
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const MAX_PERSISTED_TOOL_VALUE_BYTES = 50 * 1024
export const MAX_PERSISTED_ASSISTANT_TURN_BYTES = 512 * 1024
export const MAX_MODEL_ASSISTANT_TURN_BYTES = 96 * 1024

/** Rich assistant turn content persisted in chat history. */
export type ChatMessagePart =
  | { type: 'text'; content: string; stepIndex?: number }
  | { type: 'thinking'; content: string; stepIndex?: number; durationMs?: number }
  | {
      type: 'tool-call'
      toolName: string
      summary: string
      stepIndex?: number
      toolCallId?: string
      input?: JsonValue
      mutating?: boolean
      truncated?: boolean
      recovery?: TranscriptRecovery
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
      mutating?: boolean
      truncated?: boolean
      recovery?: TranscriptRecovery
    }

export type TranscriptRecovery = {
  toolName: string
  input: JsonValue
  instruction: string
}

/** Client-side chat message with a stable id for React keys. */
export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
  /** Attached element/slide context for user turns (composer + history). */
  context?: ChatMessageContext
}

/** API payload message (optional client ids enable server-side deduplication). */
export type ApiChatMessage = {
  id?: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
  context?: ChatMessageContext
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
 * Slide(s) the user attached as chat context so the agent can focus reads/edits
 * on those slides.
 */
export type SlideContext = {
  slideIndex: number
  slideId?: string
  title?: string
}

/** Optional context attached to a user chat turn. */
export type ChatMessageContext = {
  editorSelection?: EditorSelectionContext
  slideContexts?: SlideContext[]
}

/**
 * Context policy (pi-style): every generation request replays the full visible
 * conversation. Durable assistant turns retain every logical step using bounded,
 * recoverable tool projections. Mutations are never recommended for replay.
 * Model context is assembled separately and may summarize older steps in a
 * prefixed user-context ledger without mutating persisted chat.
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
    if (part.type === 'thinking' && typeof part.content === 'string') {
      const durationMs = part.durationMs
      if (
        durationMs !== undefined &&
        (!Number.isInteger(durationMs) || (durationMs as number) < 0)
      ) {
        return {
          ok: false as const,
          error: `messages[${messageIndex}].parts[${partIndex}].durationMs must be a non-negative integer.`,
        }
      }
      parts.push({
        type: 'thinking',
        content: part.content,
        ...(stepIndex !== undefined ? { stepIndex: stepIndex as number } : {}),
        ...(durationMs !== undefined ? { durationMs: durationMs as number } : {}),
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
        ...(typeof part.mutating === 'boolean' ? { mutating: part.mutating } : {}),
        ...(typeof part.truncated === 'boolean' ? { truncated: part.truncated } : {}),
        ...(part.recovery &&
        typeof part.recovery === 'object' &&
        !Array.isArray(part.recovery) &&
        typeof (part.recovery as Record<string, unknown>).toolName === 'string' &&
        typeof (part.recovery as Record<string, unknown>).instruction === 'string' &&
        isJsonValue((part.recovery as Record<string, unknown>).input)
          ? { recovery: part.recovery as TranscriptRecovery }
          : {}),
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

  const attachments: ChatAttachment[] = []
  let totalInlineBytes = 0

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
      totalInlineBytes += estimatedBytes
      if (totalInlineBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
        return {
          ok: false,
          error: `messages[${messageIndex}].attachments exceed the ${MAX_CHAT_ATTACHMENT_TOTAL_BYTES} byte combined inline limit.`,
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

function parseChatMessageContext(
  input: unknown,
  messageIndex: number,
): { ok: true; context?: ChatMessageContext } | { ok: false; error: string } {
  if (input === undefined) {
    return { ok: true }
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: `messages[${messageIndex}].context must be an object.`,
    }
  }

  const record = input as {
    editorSelection?: unknown
    slideContexts?: unknown
  }
  const context: ChatMessageContext = {}

  if (record.editorSelection !== undefined) {
    const selection = record.editorSelection
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.editorSelection must be an object.`,
      }
    }
    const slideIndex = (selection as { slideIndex?: unknown }).slideIndex
    const elementId = (selection as { elementId?: unknown }).elementId
    if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex) || slideIndex < 0) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.editorSelection.slideIndex must be a non-negative integer.`,
      }
    }
    if (typeof elementId !== 'string' || elementId.trim().length === 0) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.editorSelection.elementId must be a string.`,
      }
    }
    const editorSelection: EditorSelectionContext = {
      slideIndex,
      elementId: elementId.trim(),
    }
    const slideId = (selection as { slideId?: unknown }).slideId
    if (typeof slideId === 'string' && slideId.trim()) {
      editorSelection.slideId = slideId.trim()
    }
    const elementKind = (selection as { elementKind?: unknown }).elementKind
    if (typeof elementKind === 'string' && elementKind.trim()) {
      editorSelection.elementKind = elementKind.trim()
    }
    const elementRole = (selection as { elementRole?: unknown }).elementRole
    if (typeof elementRole === 'string' && elementRole.trim()) {
      editorSelection.elementRole = elementRole.trim()
    }
    const textPreview = (selection as { textPreview?: unknown }).textPreview
    if (typeof textPreview === 'string' && textPreview.trim()) {
      editorSelection.textPreview = textPreview.trim().slice(0, 280)
    }
    if (typeof (selection as { locked?: unknown }).locked === 'boolean') {
      editorSelection.locked = (selection as { locked: boolean }).locked
    }
    if (typeof (selection as { managed?: unknown }).managed === 'boolean') {
      editorSelection.managed = (selection as { managed: boolean }).managed
    }
    context.editorSelection = editorSelection
  }

  if (record.slideContexts !== undefined) {
    if (!Array.isArray(record.slideContexts)) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.slideContexts must be an array.`,
      }
    }
    if (record.slideContexts.length > 64) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.slideContexts exceeds the 64 slide limit.`,
      }
    }
    const slideContexts: SlideContext[] = []
    for (const [slideOffset, item] of record.slideContexts.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return {
          ok: false,
          error: `messages[${messageIndex}].context.slideContexts[${slideOffset}] must be an object.`,
        }
      }
      const slideIndex = (item as { slideIndex?: unknown }).slideIndex
      if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex) || slideIndex < 0) {
        return {
          ok: false,
          error: `messages[${messageIndex}].context.slideContexts[${slideOffset}].slideIndex must be a non-negative integer.`,
        }
      }
      const slide: SlideContext = { slideIndex }
      const slideId = (item as { slideId?: unknown }).slideId
      if (typeof slideId === 'string' && slideId.trim()) {
        slide.slideId = slideId.trim()
      }
      const title = (item as { title?: unknown }).title
      if (typeof title === 'string' && title.trim()) {
        slide.title = title.trim().slice(0, 200)
      }
      slideContexts.push(slide)
    }
    if (slideContexts.length > 0) {
      context.slideContexts = slideContexts
    }
  }

  if (!context.editorSelection && !context.slideContexts?.length) {
    return { ok: true }
  }

  return { ok: true, context }
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

    const context =
      role === 'user'
        ? parseChatMessageContext((item as { context?: unknown }).context, index)
        : null
    if (context && !context.ok) {
      return context
    }

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
        ...(role === 'user' && context?.ok && context.context ? { context: context.context } : {}),
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

function describeOneSlideContext(slide: SlideContext): string {
  const titleNote = slide.title ? ` ("${slide.title}")` : ''
  const idNote = slide.slideId ? `, slide id "${slide.slideId}"` : ''
  return `slide ${slide.slideIndex}${titleNote}${idNote}`
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

export function wrapUserPromptForAgent(
  prompt: string,
  currentHtml: string,
  attachmentCount = 0,
  editorSelection?: EditorSelectionContext,
  slideContexts?: SlideContext[],
) {
  const effectivePrompt =
    prompt.trim() ||
    (attachmentCount > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

  const attachmentNote =
    attachmentCount > 0
      ? `\n\nThe user attached ${attachmentCount} file(s). Use them as reference for content, layout, branding, or visuals.`
      : ''

  const selectionNote = editorSelection ? `\n\n${describeEditorSelection(editorSelection)}` : ''
  const slideNote =
    slideContexts && slideContexts.length > 0 ? `\n\n${describeSlideContexts(slideContexts)}` : ''

  if (currentHtml.trim()) {
    return `The user wants to revise their Ark HTML deck.

User instruction:
${effectivePrompt}${attachmentNote}${selectionNote}${slideNote}

The current deck is available in the job workspace. Inspect it with the available tools before editing.`
  }

  return `Create a new complete Ark HTML slide deck from this user request:

${effectivePrompt}${attachmentNote}

Use the available tools to save the deck, then summarize what you built.`
}

/** Media types that models should receive as text, not provider file parts. */
export function isReadableTextMediaType(mediaType: string) {
  const normalized = mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  return normalized.startsWith('text/') || normalized === 'application/json'
}

/** Max characters of decoded text inlined into a model TextPart per attachment. */
export const MAX_INLINE_TEXT_ATTACHMENT_CHARS = 256 * 1024

function decodeBase64ToUtf8(base64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf8')
  }

  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Decode a `data:` URL payload to UTF-8 text. Returns null when the URL is invalid. */
export function decodeDataUrlText(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:')) {
    return null
  }

  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) {
    return null
  }

  const meta = dataUrl.slice(5, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  const isBase64 = meta.split(';').some((parameter) => parameter.trim().toLowerCase() === 'base64')

  try {
    if (isBase64) {
      return decodeBase64ToUtf8(payload)
    }

    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

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

    parts.push({
      type: 'file',
      mediaType: attachment.mediaType,
      data: attachment.url,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    })
  }

  return parts
}

export function buildUserModelContent(
  message: ApiChatMessage,
  options?: {
    wrapForAgent?: boolean
    currentHtml?: string
    editorSelection?: EditorSelectionContext
    slideContexts?: SlideContext[]
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

export function toApiMessages(messages: ChatMessage[]): ApiChatMessage[] {
  return messages.map(({ id, role, content, attachments, parts, context }) => ({
    ...(id ? { id } : {}),
    role,
    content,
    ...(attachments?.length ? { attachments } : {}),
    ...(role === 'assistant' && parts?.length ? { parts: structuredClone(parts) } : {}),
    ...(role === 'user' && context ? { context: structuredClone(context) } : {}),
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

    if (step.type === 'thinking') {
      parts.push({
        type: 'thinking',
        content: step.summary,
        ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
      })
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
