import type { ModelMessage } from 'ai'

import {
  MAX_MODEL_ASSISTANT_TURN_BYTES,
  buildUserModelContent,
  type ApiChatMessage,
  type ChatMessagePart,
  type EditorSelectionContext,
  type JsonValue,
} from './chat.ts'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

export type DeckAgentContextMetadata = {
  transformVersion: 1
  omittedStepCount: number
  bytesBefore: number
  bytesAfter: number
}

const groupParts = (parts: readonly ChatMessagePart[]) => {
  const groups = new Map<number, ChatMessagePart[]>()
  for (const part of parts) {
    if (part.stepIndex === undefined) return null
    groups.set(part.stepIndex, [...(groups.get(part.stepIndex) ?? []), part])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b)
}

const ledgerEntry = (parts: readonly ChatMessagePart[]) => {
  const calls = parts.filter((part) => part.type === 'tool-call')
  const results = parts.filter((part) => part.type === 'tool-result')
  if (!calls.length) {
    const text = parts.find((part) => part.type === 'text')
    return text ? `- assistant: ${text.content.slice(0, 180)}` : '- assistant step'
  }
  return calls
    .map((call) => {
      const result = results.find((item) => item.toolCallId === call.toolCallId)
      const error = result?.isError || result?.error ? 'error: ' : ''
      return `- ${call.toolName} ${call.summary} -> ${error}${result?.summary ?? 'result unavailable'}`.slice(
        0,
        320,
      )
    })
    .join('\n')
}

const buildLedger = (groups: Array<[number, ChatMessagePart[]]>, stepIndex: number) => ({
  type: 'text' as const,
  stepIndex,
  content: `[Earlier agent steps summarized for replay]\n${groups
    .slice(-40)
    .map(([, parts]) => ledgerEntry(parts))
    .join(
      '\n',
    )}${groups.length > 40 ? `\n- ${groups.length - 40} additional steps omitted` : ''}\n[Current deck state is authoritative; inspect it again before editing.]`,
})

const compactStep = (parts: readonly ChatMessagePart[]): ChatMessagePart[] =>
  parts.map((part) => {
    if (part.type === 'tool-call') {
      return {
        ...part,
        input: {
          omittedForModel: true,
          summary: part.summary,
          instruction: `Call ${part.toolName} again if its input details are needed.`,
        },
      }
    }
    if (part.type === 'tool-result') {
      return {
        ...part,
        output: {
          omittedForModel: true,
          summary: part.summary,
          instruction: `Call ${part.toolName} again to recover current data.`,
        },
      }
    }
    return part
  })

export function projectAssistantTurnForModel(
  parts: readonly ChatMessagePart[],
  maxBytes = MAX_MODEL_ASSISTANT_TURN_BYTES,
): { parts: ChatMessagePart[]; omittedStepCount: number; bytesBefore: number; bytesAfter: number } {
  const bytesBefore = bytes(parts)
  const groups = groupParts(parts)
  if (!groups || bytesBefore <= maxBytes)
    return { parts: [...parts], omittedStepCount: 0, bytesBefore, bytesAfter: bytesBefore }

  const kept: Array<[number, ChatMessagePart[]]> = []
  for (const group of groups.toReversed()) {
    const omitted = groups.slice(0, groups.length - kept.length - 1)
    const candidateGroup: [number, ChatMessagePart[]] =
      kept.length === 0 ? [group[0], compactStep(group[1])] : group
    const marker = omitted.length ? buildLedger(omitted, Math.max(0, candidateGroup[0] - 1)) : null
    const candidate = [
      ...(marker ? [marker] : []),
      ...candidateGroup[1],
      ...kept.flatMap(([, p]) => p),
    ]
    if (bytes(candidate) > maxBytes) break
    kept.unshift(candidateGroup)
  }

  if (!kept.length) {
    const finalText = [...parts].reverse().find((part) => part.type === 'text')
    const projected = finalText ? [finalText] : [buildLedger(groups, groups.at(-1)?.[0] ?? 0)]
    return {
      parts: projected,
      omittedStepCount: groups.length,
      bytesBefore,
      bytesAfter: bytes(projected),
    }
  }

  const omitted = groups.slice(0, groups.length - kept.length)
  const projected = [
    ...(omitted.length ? [buildLedger(omitted, Math.max(0, kept[0][0] - 1))] : []),
    ...kept.flatMap(([, stepParts]) => stepParts),
  ]
  return {
    parts: projected,
    omittedStepCount: omitted.length,
    bytesBefore,
    bytesAfter: bytes(projected),
  }
}

function replayAssistant(message: ApiChatMessage, limits?: { maxAssistantTurnBytes?: number }) {
  const parts = message.parts
  if (!parts?.length)
    return { messages: [{ role: 'assistant' as const, content: message.content }], metadata: null }
  const replayable = parts.some((part) => part.type !== 'text')
  if (!replayable) {
    const text = parts.every((part) => part.type === 'text' && part.stepIndex !== undefined)
      ? parts.map((part) => (part.type === 'text' ? part.content : '')).join('\n')
      : message.content
    return { messages: [{ role: 'assistant' as const, content: text }], metadata: null }
  }

  const groups = groupParts(parts)
  if (!groups)
    return { messages: [{ role: 'assistant' as const, content: message.content }], metadata: null }
  const ids = new Set<string>()
  for (const [, step] of groups) {
    const calls = step.filter((part) => part.type === 'tool-call')
    const results = step.filter((part) => part.type === 'tool-result')
    if (
      calls.length !== results.length ||
      calls.some(
        (call) =>
          !call.toolCallId ||
          call.input === undefined ||
          ids.has(call.toolCallId) ||
          results.filter(
            (result) => result.toolCallId === call.toolCallId && result.toolName === call.toolName,
          ).length !== 1,
      ) ||
      results.some((result) => !result.toolCallId)
    )
      return {
        messages: [{ role: 'assistant' as const, content: message.content }],
        metadata: null,
      }
    calls.forEach((call) => ids.add(call.toolCallId!))
  }

  const projection = projectAssistantTurnForModel(
    parts,
    limits?.maxAssistantTurnBytes ?? MAX_MODEL_ASSISTANT_TURN_BYTES,
  )
  const projectedGroups = groupParts(projection.parts) ?? []
  const emitted: ModelMessage[] = []
  for (const [, step] of projectedGroups) {
    const calls = step.filter((part) => part.type === 'tool-call')
    const results = step.filter((part) => part.type === 'tool-result')
    const assistantContent: Array<Record<string, unknown>> = []
    for (const part of step) {
      if (part.type === 'text') assistantContent.push({ type: 'text', text: part.content })
      if (part.type === 'tool-call')
        assistantContent.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        })
    }
    if (assistantContent.length)
      emitted.push({ role: 'assistant', content: assistantContent } as ModelMessage)
    if (calls.length)
      emitted.push({
        role: 'tool',
        content: calls.map((call) => {
          const result = results.find((item) => item.toolCallId === call.toolCallId)!
          return {
            type: 'tool-result',
            toolCallId: call.toolCallId!,
            toolName: call.toolName,
            output: {
              type: result.isError ? 'error-json' : 'json',
              value: (result.output ?? null) as JsonValue,
            },
          }
        }),
      } as ModelMessage)
  }
  return { messages: emitted, metadata: projection }
}

export function convertChatHistoryToModelMessages(messages: ApiChatMessage[]): ModelMessage[] {
  return messages.flatMap((message) =>
    message.role === 'user'
      ? [{ role: 'user' as const, content: buildUserModelContent(message) }]
      : replayAssistant(message).messages,
  )
}

export function assembleDeckAgentContext({
  messages,
  currentHtml,
  editorSelection,
  projectionLimits,
}: {
  messages: ApiChatMessage[]
  currentHtml: string
  editorSelection?: EditorSelectionContext
  projectionLimits?: { maxAssistantTurnBytes?: number }
}): { modelMessages: ModelMessage[]; metadata: DeckAgentContextMetadata } {
  let omittedStepCount = 0
  let bytesBefore = 0
  let bytesAfter = 0
  const last = messages.at(-1)
  const prior = last?.role === 'user' ? messages.slice(0, -1) : messages
  const modelMessages = prior.flatMap((message) => {
    if (message.role === 'user')
      return [{ role: 'user' as const, content: buildUserModelContent(message) }]
    const replay = replayAssistant(message, projectionLimits)
    if (replay.metadata) {
      omittedStepCount += replay.metadata.omittedStepCount
      bytesBefore += replay.metadata.bytesBefore
      bytesAfter += replay.metadata.bytesAfter
    }
    return replay.messages
  })
  if (last?.role === 'user')
    modelMessages.push({
      role: 'user',
      content: buildUserModelContent(last, { wrapForAgent: true, currentHtml, editorSelection }),
    })
  return {
    modelMessages,
    metadata: { transformVersion: 1, omittedStepCount, bytesBefore, bytesAfter },
  }
}

export function buildAgentModelMessages(
  messages: ApiChatMessage[],
  currentHtml: string,
  editorSelection?: EditorSelectionContext,
) {
  return assembleDeckAgentContext({ messages, currentHtml, editorSelection }).modelMessages
}
