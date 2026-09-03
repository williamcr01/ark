import type { ChatAttachment } from './attachments.ts'
import { parseChatAttachments } from './attachments.ts'
import type { ChatMessageContext } from './context.ts'
import { parseChatMessageContext } from './context.ts'
import type {
  AgentStep,
  ChatMessage,
  ChatMessagePart,
  ChatMessageRole,
  JsonValue,
  TranscriptRecovery,
} from './messages.ts'
import {
  isValidChatMessageId,
  MAX_PERSISTED_ASSISTANT_TURN_BYTES,
  MAX_PERSISTED_TOOL_VALUE_BYTES,
} from './messages.ts'

/** API payload message (optional client ids enable server-side deduplication). */
export type ApiChatMessage = {
  id?: string
  role: ChatMessageRole
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
  context?: ChatMessageContext
}

export type ParseGenerateMessagesResult =
  { ok: true; messages: ApiChatMessage[] } | { ok: false; error: string }

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const isChatMessageRole = (value: unknown): value is ChatMessageRole =>
  value === 'user' || value === 'assistant'

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
