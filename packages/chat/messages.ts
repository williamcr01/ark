import type { ChatAttachment } from './attachments.ts'
import type { ChatMessageContext } from './context.ts'

export type ChatMessageRole = 'user' | 'assistant'

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
