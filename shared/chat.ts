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

export type ParseGenerateMessagesResult =
  | { ok: true; messages: ApiChatMessage[] }
  | { ok: false; error: string }

const isChatMessageRole = (value: unknown): value is ChatMessageRole =>
  value === 'user' || value === 'assistant'

/** Runtime validation for untrusted `/api/generate` request bodies. */
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

    const trimmed = content.trim()
    if (trimmed.length > 0) {
      messages.push({ role, content: trimmed })
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
