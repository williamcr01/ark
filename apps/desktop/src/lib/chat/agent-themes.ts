import {
  isThemeRefreshContent,
  parseStoredThemeProposalRequest,
  parseThemeChoiceId,
  type StoredThemeProposalRequest,
} from '@ark/chat/agent-themes.ts'
import type { ChatMessage } from '@ark/chat/messages.ts'

export function getThemeProposalRequest(message: ChatMessage): StoredThemeProposalRequest | null {
  if (message.role !== 'assistant') return null
  for (const part of message.parts ?? []) {
    if (part.type !== 'tool-call' || part.toolName !== 'propose_themes') continue
    const parsed = parseStoredThemeProposalRequest(part.input)
    if (parsed) return parsed
  }
  return null
}

export function findPendingThemeProposal(
  messages: ChatMessage[],
): StoredThemeProposalRequest | null {
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')

  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const request = getThemeProposalRequest(messages[index]!)
    if (request) return request
  }

  return null
}

/** User turn that answers the immediately preceding propose_themes assistant turn. */
export function isThemeChoiceMessage(messages: ChatMessage[], index: number) {
  const message = messages[index]
  if (!message || message.role !== 'user') return false
  const previous = messages[index - 1]
  if (!previous || !getThemeProposalRequest(previous)) return false
  return (
    Boolean(message.context?.themeSelection) ||
    parseThemeChoiceId(message.content) !== null ||
    isThemeRefreshContent(message.content)
  )
}

export function findThemeChoiceAfter(messages: ChatMessage[], assistantIndex: number) {
  const next = messages[assistantIndex + 1]
  if (!next || next.role !== 'user') return null
  if (!getThemeProposalRequest(messages[assistantIndex]!)) return null
  if (
    !next.context?.themeSelection &&
    parseThemeChoiceId(next.content) === null &&
    !isThemeRefreshContent(next.content)
  ) {
    return null
  }
  return next
}
