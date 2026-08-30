import { agentQuestionRequestSchema, type AgentQuestionRequest } from '@ark/chat/agent-questions.ts'
import type { ChatMessage } from '@ark/chat/chat.ts'

export function getAskUserRequest(message: ChatMessage): AgentQuestionRequest | null {
  if (message.role !== 'assistant') return null
  for (const part of message.parts ?? []) {
    if (part.type !== 'tool-call' || part.toolName !== 'ask_user') continue
    const parsed = agentQuestionRequestSchema.safeParse(part.input)
    if (parsed.success) return parsed.data
  }
  return null
}

export function findPendingAgentQuestions(messages: ChatMessage[]): AgentQuestionRequest | null {
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')

  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const request = getAskUserRequest(messages[index]!)
    if (request) return request
  }

  return null
}

/** User turn that answers the immediately preceding ask_user assistant turn. */
export function isAskUserAnswerMessage(messages: ChatMessage[], index: number) {
  const message = messages[index]
  if (!message || message.role !== 'user') return false
  const previous = messages[index - 1]
  return Boolean(previous && getAskUserRequest(previous))
}

export function findAskUserAnswerAfter(messages: ChatMessage[], assistantIndex: number) {
  const next = messages[assistantIndex + 1]
  if (!next || next.role !== 'user') return null
  if (!getAskUserRequest(messages[assistantIndex]!)) return null
  return next
}
