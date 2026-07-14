import type { ModelMessage } from 'ai'

import {
  MAX_MODEL_ASSISTANT_TURN_BYTES,
  MAX_PERSISTED_ASSISTANT_TURN_BYTES,
  buildUserModelContent,
  type ApiChatMessage,
  type ChatMessagePart,
  type EditorSelectionContext,
  type JsonValue,
} from './chat.ts'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
const stringBytes = (value: string) => new TextEncoder().encode(value).byteLength

export type DeckAgentContextMetadata = {
  transformVersion: 1
  omittedStepCount: number
  bytesBefore: number
  bytesAfter: number
}

type PartGroup = [number, ChatMessagePart[]]

const groupParts = (parts: readonly ChatMessagePart[]): PartGroup[] | null => {
  const groups = new Map<number, ChatMessagePart[]>()
  for (const part of parts) {
    if (part.stepIndex === undefined) return null
    groups.set(part.stepIndex, [...(groups.get(part.stepIndex) ?? []), part])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b)
}

const stableHash = (value: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const utf8Prefix = (value: string, maxBytes: number) => {
  let prefix = ''
  let used = 0
  for (const character of value) {
    const size = stringBytes(character)
    if (used + size > Math.max(0, maxBytes)) break
    prefix += character
    used += size
  }
  return prefix
}

const truncateText = (value: string, maxBytes: number, reason: string) => {
  if (stringBytes(value) <= maxBytes) return value
  const marker = `\n[${reason}; ${stringBytes(value)} bytes; hash:${stableHash(value)}]`
  if (stringBytes(marker) >= maxBytes) return utf8Prefix(marker.trimStart(), maxBytes)
  return `${utf8Prefix(value, maxBytes - stringBytes(marker))}${marker}`
}

const compactPart = (part: ChatMessagePart, reason: 'model' | 'persistence'): ChatMessagePart => {
  if (part.type === 'text' || part.type === 'thinking') {
    return {
      ...part,
      content: truncateText(
        part.content,
        reason === 'model' ? 8 * 1024 : 32 * 1024,
        `assistant ${part.type} truncated for ${reason}`,
      ),
    }
  }
  const instruction =
    part.recovery?.instruction ??
    (part.mutating
      ? `Do not repeat ${part.toolName}; inspect the current deck to verify its effect.`
      : `Inspect the current deck before continuing; no replay recovery was recorded.`)
  const compactValue: JsonValue = {
    [`omittedFor${reason === 'model' ? 'Model' : 'Persistence'}`]: true,
    summary: part.summary.slice(0, 320),
    instruction,
    ...(part.type === 'tool-result' ? { isError: part.isError ?? part.error ?? false } : {}),
  }
  return part.type === 'tool-call'
    ? { ...part, summary: part.summary.slice(0, 320), input: compactValue }
    : { ...part, summary: part.summary.slice(0, 320), output: compactValue }
}

export function projectAssistantTurnForPersistence(
  parts: readonly ChatMessagePart[],
  maxBytes = MAX_PERSISTED_ASSISTANT_TURN_BYTES,
): ChatMessagePart[] {
  const cloned = parts.map((part) => structuredClone(part))
  if (bytes(cloned) <= maxBytes) return cloned

  let projected = cloned.map((part) =>
    part.type === 'text' || part.type === 'thinking' ? part : compactPart(part, 'persistence'),
  )
  if (bytes(projected) <= maxBytes) return projected

  const textCount = Math.max(
    1,
    projected.filter((part) => part.type === 'text' || part.type === 'thinking').length,
  )
  const nonTextBytes = bytes(
    projected.filter((part) => part.type !== 'text' && part.type !== 'thinking'),
  )
  const textBudget = Math.max(128, Math.floor((maxBytes - nonTextBytes - 1024) / textCount))
  projected = projected.map((part) =>
    part.type === 'text' || part.type === 'thinking'
      ? {
          ...part,
          content: truncateText(
            part.content,
            textBudget,
            `assistant ${part.type} truncated for persistence`,
          ),
        }
      : part,
  )
  if (bytes(projected) <= maxBytes) return projected

  const groups = groupParts(cloned) ?? []
  const ledgerBudget = Math.max(0, maxBytes - 128)
  const ledger = truncateText(
    `[Durable agent transcript compacted; logical details follow]\n${buildLedger(groups, ledgerBudget)}`,
    ledgerBudget,
    'durable transcript ledger truncated',
  )
  const fallback: ChatMessagePart[] = [
    { type: 'text', stepIndex: groups.at(-1)?.[0] ?? 0, content: ledger },
  ]
  return bytes(fallback) <= maxBytes ? fallback : []
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
      const mutation = call.mutating ? 'mutation; do not repeat; ' : ''
      const recovery = result?.recovery?.instruction ?? call.recovery?.instruction
      return `- ${call.toolName} ${call.summary} -> ${mutation}${error}${result?.summary ?? 'result unavailable'}${recovery ? `; ${recovery}` : ''}`.slice(
        0,
        360,
      )
    })
    .join('\n')
}

const isPriorityGroup = ([, parts]: PartGroup) =>
  parts.some(
    (part) =>
      ((part.type === 'tool-call' || part.type === 'tool-result') && part.mutating) ||
      (part.type === 'tool-result' && (part.isError === true || part.error === true)),
  )

const buildLedger = (groups: PartGroup[], maxBytes: number) => {
  if (!groups.length || maxBytes < 160) return ''
  const header = '[Earlier agent steps summarized for replay]'
  const footer = '[Current deck state is authoritative; inspect it again before editing.]'
  const priority = groups.filter(isPriorityGroup)
  const recent = groups.filter((group) => !isPriorityGroup(group)).toReversed()
  const selected: string[] = []
  let represented = 0
  for (const group of [...priority, ...recent]) {
    const entry = ledgerEntry(group[1])
    const candidate = `${header}\n${[...selected, entry].join('\n')}\n${footer}`
    if (bytes(candidate) > maxBytes) continue
    selected.push(entry)
    represented += 1
  }
  const omitted = groups.length - represented
  const suffix = omitted ? `\n- ${omitted} additional successful read/text step(s) omitted` : ''
  const ledger = `${header}\n${selected.join('\n')}${suffix}\n${footer}`
  const withoutSuffix = `${header}\n${selected.join('\n')}\n${footer}`
  return truncateText(
    bytes(ledger) <= maxBytes ? ledger : withoutSuffix,
    maxBytes,
    'semantic ledger truncated',
  )
}

export type AssistantTurnModelProjection = {
  parts: ChatMessagePart[]
  ledger?: string
  omittedStepCount: number
  bytesBefore: number
  bytesAfter: number
}

const projectionBytes = (parts: ChatMessagePart[], ledger?: string) => bytes({ parts, ledger })

export function projectAssistantTurnForModel(
  parts: readonly ChatMessagePart[],
  maxBytes = MAX_MODEL_ASSISTANT_TURN_BYTES,
): AssistantTurnModelProjection {
  const bytesBefore = bytes(parts)
  const groups = groupParts(parts.map((part) => structuredClone(part)))
  const unprojectedBytes = projectionBytes([...parts])
  if (!groups || unprojectedBytes <= maxBytes)
    return { parts: [...parts], omittedStepCount: 0, bytesBefore, bytesAfter: unprojectedBytes }

  const kept: PartGroup[] = []
  for (const group of groups.toReversed()) {
    const omitted = groups.slice(0, groups.length - kept.length - 1)
    const exactParts = [...group[1], ...kept.flatMap(([, value]) => value)]
    const exactLedger = buildLedger(omitted, Math.max(0, maxBytes - bytes(exactParts) - 32))
    if (projectionBytes(exactParts, exactLedger || undefined) <= maxBytes) {
      kept.unshift(group)
      continue
    }
    if (!kept.length) {
      const compacted: PartGroup = [group[0], group[1].map((part) => compactPart(part, 'model'))]
      const compactedLedger = buildLedger(omitted, Math.max(0, maxBytes - bytes(compacted[1]) - 32))
      if (projectionBytes(compacted[1], compactedLedger || undefined) <= maxBytes)
        kept.unshift(compacted)
    }
    break
  }

  const omitted = groups.slice(0, groups.length - kept.length)
  let projectedParts = kept.flatMap(([, value]) => value)
  let ledger = buildLedger(omitted, Math.max(0, maxBytes - bytes(projectedParts) - 32))
  if (!projectedParts.length) {
    const latest = groups.at(-1)!
    projectedParts = latest[1].map((part) => compactPart(part, 'model'))
    ledger = buildLedger(groups.slice(0, -1), Math.max(0, maxBytes - bytes(projectedParts) - 32))
  }
  if (projectionBytes(projectedParts, ledger || undefined) > maxBytes) {
    const textParts = projectedParts.filter((part) => part.type === 'text')
    const withoutText = projectedParts.map((part) =>
      part.type === 'text' ? { ...part, content: '' } : part,
    )
    const totalTextBudget = Math.max(
      0,
      maxBytes - projectionBytes(withoutText, ledger || undefined) - 32,
    )
    const perTextBudget = Math.floor(totalTextBudget / Math.max(1, textParts.length))
    projectedParts = projectedParts.map((part) =>
      part.type === 'text'
        ? {
            ...part,
            content: truncateText(
              part.content,
              perTextBudget,
              'assistant text truncated for model context',
            ),
          }
        : part,
    )
  }
  if (projectionBytes(projectedParts, ledger || undefined) > maxBytes) {
    projectedParts = []
    ledger = buildLedger(groups, Math.max(0, maxBytes - projectionBytes([]) - 16))
  }
  if (projectionBytes(projectedParts, ledger || undefined) > maxBytes) {
    ledger = ''
  }
  const bytesAfter = projectionBytes(projectedParts, ledger || undefined)
  if (bytesAfter > maxBytes) {
    throw new Error('Assistant model projection exceeded its configured ceiling.')
  }
  return {
    parts: projectedParts,
    ...(ledger ? { ledger } : {}),
    omittedStepCount: projectedParts.length ? omitted.length : groups.length,
    bytesBefore,
    bytesAfter,
  }
}

function replayAssistant(message: ApiChatMessage, limits?: { maxAssistantTurnBytes?: number }) {
  const parts = message.parts
  if (!parts?.length)
    return { messages: [{ role: 'assistant' as const, content: message.content }], metadata: null }
  // Thinking is UI-only; strip it before model replay so tool transcripts stay valid.
  const modelParts = parts.filter((part) => part.type !== 'thinking')
  if (!modelParts.length)
    return { messages: [{ role: 'assistant' as const, content: message.content }], metadata: null }
  const replayable = modelParts.some(
    (part) => part.type === 'tool-call' || part.type === 'tool-result',
  )
  if (!replayable) {
    const text = modelParts.every((part) => part.type === 'text' && part.stepIndex !== undefined)
      ? modelParts.map((part) => (part.type === 'text' ? part.content : '')).join('\n')
      : message.content
    return { messages: [{ role: 'assistant' as const, content: text }], metadata: null }
  }

  const groups = groupParts(modelParts)
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
    modelParts,
    limits?.maxAssistantTurnBytes ?? MAX_MODEL_ASSISTANT_TURN_BYTES,
  )
  const projectedGroups = groupParts(projection.parts) ?? []
  const emitted: ModelMessage[] = projection.ledger
    ? [{ role: 'user', content: projection.ledger }]
    : []
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
