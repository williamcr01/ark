import type { ChatMessage } from '@ark/chat/messages.ts'

/**
 * Merge server chat with local state, preserving only messages explicitly marked
 * as failed to persist. Server history is authoritative for everything else.
 */
export function reconcileChatMessages(
  localMessages: ChatMessage[],
  serverMessages: ChatMessage[],
  knownFailedIds: Iterable<string> = [],
): { messages: ChatMessage[]; failedIds: Set<string> } {
  const serverMap = new Map(serverMessages.map((message) => [message.id, message]))
  const failedIds = new Set([...knownFailedIds].filter((id) => !serverMap.has(id)))

  const merged: ChatMessage[] = []
  const included = new Set<string>()

  for (const local of localMessages) {
    const server = serverMap.get(local.id)

    if (server) {
      merged.push(server)
      included.add(local.id)
      continue
    }

    if (failedIds.has(local.id)) {
      merged.push(local)
      included.add(local.id)
    }
  }

  for (const server of serverMessages) {
    if (!included.has(server.id)) {
      merged.push(server)
    }
  }

  return { messages: merged, failedIds }
}
