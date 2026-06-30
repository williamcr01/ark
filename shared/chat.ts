export type ChatMessageRole = 'user' | 'assistant'

/** Client-side chat message with a stable id for React keys. */
export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
}

/** API payload message (ids are optional and ignored server-side). */
export type ApiChatMessage = {
  id?: string
  role: ChatMessageRole
  content: string
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

export function normalizeGenerateMessages(
  messages: ApiChatMessage[] | undefined,
): ApiChatMessage[] {
  if (!messages?.length) {
    return []
  }

  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
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
  return messages.map(({ role, content }) => ({ role, content }))
}
