import type { ChatMessage } from '../../shared/chat.ts'

/**
 * Merge server chat with local cache without dropping messages that never
 * reached the server. Preserves local ordering for messages the user already
 * saw; appends server-only messages (e.g. from another device) at the end.
 */
export function reconcileChatMessages(
  localMessages: ChatMessage[],
  serverMessages: ChatMessage[],
  knownFailedIds: Iterable<string> = [],
): { messages: ChatMessage[]; failedIds: Set<string> } {
  const serverMap = new Map(serverMessages.map((message) => [message.id, message]))
  const failedIds = new Set(knownFailedIds)

  for (const local of localMessages) {
    if (!serverMap.has(local.id)) {
      failedIds.add(local.id)
    }
  }

  const merged: ChatMessage[] = []
  const included = new Set<string>()

  for (const local of localMessages) {
    const server = serverMap.get(local.id)

    if (server) {
      merged.push(server)
      included.add(local.id)
      failedIds.delete(local.id)
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
