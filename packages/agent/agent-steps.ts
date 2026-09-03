import type { AgentStep, ChatMessagePart, JsonValue } from '@ark/chat/messages.ts'
import {
  findToolDefinition,
  normalizeTranscriptValue,
  type DeckToolDefinition,
} from './tool-catalog.ts'

function summarizeToolInput(toolName: string, input: unknown) {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const record = input as Record<string, unknown>

  switch (toolName) {
    case 'read_deck': {
      if (typeof record.slideIndex === 'number') {
        return `slide ${record.slideIndex}`
      }

      const offset = typeof record.offset === 'number' ? record.offset : 1
      const limit = typeof record.limit === 'number' ? record.limit : 'default'
      return `lines ${offset}–${limit}`
    }
    case 'edit_deck':
      return `${Array.isArray(record.edits) ? record.edits.length : 0} patch(es)`
    case 'patch_deck':
    case 'patch_element':
      return `${Array.isArray(record.operations) ? record.operations.length : 0} op(s)`
    case 'write_deck':
      return 'full deck'
    case 'list_slides':
    case 'parse_deck':
      return 'outline'
    default:
      return ''
  }
}

function summarizeToolOutput(toolName: string, output: unknown) {
  if (!output || typeof output !== 'object') {
    return 'Done'
  }

  const record = output as Record<string, unknown>

  if (typeof record.error === 'string') {
    return record.error
  }

  if (typeof record.message === 'string') {
    return record.message
  }

  switch (toolName) {
    case 'list_slides':
    case 'parse_deck':
      return `${typeof record.slideCount === 'number' ? record.slideCount : 0} slide(s)`
    case 'read_deck':
      if (record.mode === 'slide' && typeof record.title === 'string') {
        return record.title
      }
      return `${typeof record.totalLines === 'number' ? record.totalLines : '?'} lines`
    case 'edit_deck':
      return typeof record.appliedCount === 'number'
        ? `Applied ${record.appliedCount} edit(s)`
        : 'Edit complete'
    case 'patch_deck':
    case 'patch_element':
      if (typeof record.summary === 'string' && record.summary) {
        return record.summary
      }
      return typeof record.appliedCount === 'number'
        ? `Applied ${record.appliedCount} operation(s)`
        : 'Patch complete'
    case 'write_deck':
      return typeof record.slideCount === 'number'
        ? `${record.slideCount} slide(s) written`
        : 'Deck written'
    default:
      return 'Done'
  }
}

export function extractAgentSteps(
  steps: Array<{
    text: string
    reasoningText?: string | null
    reasoning?: Array<{ text?: string } | string> | null
    toolCalls: Array<{ toolName: string; input: unknown }>
    toolResults: Array<{ toolName: string; output: unknown }>
    content?: Array<Record<string, unknown>>
  }>,
  definitions?: readonly DeckToolDefinition[],
): AgentStep[] {
  const events: AgentStep[] = []

  for (const step of steps) {
    const thinking = extractThinkingText(step)
    if (thinking) {
      events.push({ type: 'thinking', summary: thinking })
    }

    if (step.text.trim()) {
      events.push({ type: 'text', summary: step.text.trim() })
    }

    for (const toolCall of step.toolCalls) {
      const definition = definitions && findToolDefinition(definitions, toolCall.toolName)
      events.push({
        type: 'tool-call',
        toolName: toolCall.toolName,
        summary:
          definition?.summarizeInput(toolCall.input) ??
          summarizeToolInput(toolCall.toolName, toolCall.input),
      })
    }

    for (const toolResult of step.toolResults) {
      const definition = definitions && findToolDefinition(definitions, toolResult.toolName)
      const summary =
        definition?.summarizeOutput(toolResult.output) ??
        summarizeToolOutput(toolResult.toolName, toolResult.output)
      const isError =
        definition?.isErrorOutput(toolResult.output) ??
        (!!toolResult.output &&
          typeof toolResult.output === 'object' &&
          ('error' in toolResult.output ||
            ('ok' in toolResult.output && toolResult.output.ok === false)))

      events.push({
        type: 'tool-result',
        toolName: toolResult.toolName,
        summary,
        error: isError,
      })
    }

    for (const item of step.content ?? []) {
      if (item.type !== 'tool-error' || typeof item.toolName !== 'string') continue
      const error = item.error
      events.push({
        type: 'tool-result',
        toolName: item.toolName,
        summary:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Tool execution failed',
        error: true,
      })
    }
  }

  return events
}

const projectionMetadata = (projection: {
  truncated: boolean
  recovery?: { toolName: string; input: JsonValue; instruction: string }
}) => ({
  ...(projection.truncated ? { truncated: true } : {}),
  ...(projection.recovery ? { recovery: projection.recovery } : {}),
})

export function extractAgentTranscriptParts(
  steps: Array<{
    content?: Array<Record<string, unknown>>
    text?: string
    reasoningText?: string | null
    reasoning?: Array<{ text?: string } | string> | null
    toolCalls?: Array<Record<string, unknown>>
    toolResults?: Array<Record<string, unknown>>
  }>,
  definitions: readonly DeckToolDefinition[],
): ChatMessagePart[] {
  const parts: ChatMessagePart[] = []
  for (const [stepIndex, step] of steps.entries()) {
    const thinking = extractThinkingText(step)
    if (thinking) parts.push({ type: 'thinking', content: thinking, stepIndex })

    const content = step.content ?? []
    for (const item of content) {
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim())
        parts.push({ type: 'text', content: item.text.trim(), stepIndex })
      if (
        item.type === 'tool-call' &&
        typeof item.toolCallId === 'string' &&
        typeof item.toolName === 'string'
      ) {
        const definition = findToolDefinition(definitions, item.toolName)
        if (!definition) continue
        const projection = definition.projectInputForTranscript(item.input)
        parts.push({
          type: 'tool-call',
          toolName: item.toolName,
          toolCallId: item.toolCallId,
          stepIndex,
          summary: definition.summarizeInput(item.input),
          input: projection.value,
          mutating: definition.mutating,
          ...projectionMetadata(projection),
        })
      }
      if (
        (item.type === 'tool-result' || item.type === 'tool-error') &&
        typeof item.toolCallId === 'string' &&
        typeof item.toolName === 'string'
      ) {
        const definition = findToolDefinition(definitions, item.toolName)
        if (!definition) continue
        const projection =
          item.type === 'tool-error'
            ? { value: normalizeTranscriptValue(item.error), truncated: false }
            : definition.projectOutputForTranscript(item.output)
        parts.push({
          type: 'tool-result',
          toolName: item.toolName,
          toolCallId: item.toolCallId,
          stepIndex,
          summary:
            item.type === 'tool-error'
              ? item.error instanceof Error
                ? item.error.message
                : 'Tool execution failed'
              : definition.summarizeOutput(item.output),
          output: projection.value,
          mutating: definition.mutating,
          ...projectionMetadata(projection),
          isError: item.type === 'tool-error' || definition.isErrorOutput(item.output),
          error: item.type === 'tool-error' || definition.isErrorOutput(item.output),
        })
      }
    }
    if (!content.length) {
      appendFallbackTranscriptParts(parts, step, stepIndex, definitions)
    }
  }
  return parts
}

function appendFallbackTranscriptParts(
  parts: ChatMessagePart[],
  step: {
    text?: string
    toolCalls?: Array<Record<string, unknown>>
    toolResults?: Array<Record<string, unknown>>
  },
  stepIndex: number,
  definitions: readonly DeckToolDefinition[],
) {
  if (step.text?.trim()) parts.push({ type: 'text', content: step.text.trim(), stepIndex })
  for (const call of step.toolCalls ?? []) {
    if (typeof call.toolCallId !== 'string' || typeof call.toolName !== 'string') continue
    const definition = findToolDefinition(definitions, call.toolName)
    if (!definition) continue
    const projection = definition.projectInputForTranscript(call.input)
    parts.push({
      type: 'tool-call',
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      stepIndex,
      summary: definition.summarizeInput(call.input),
      input: projection.value,
      mutating: definition.mutating,
      ...projectionMetadata(projection),
    })
  }
  for (const result of step.toolResults ?? []) {
    if (typeof result.toolCallId !== 'string' || typeof result.toolName !== 'string') continue
    const definition = findToolDefinition(definitions, result.toolName)
    if (!definition) continue
    const projection = definition.projectOutputForTranscript(result.output)
    parts.push({
      type: 'tool-result',
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      stepIndex,
      summary: definition.summarizeOutput(result.output),
      output: projection.value,
      mutating: definition.mutating,
      ...projectionMetadata(projection),
      isError: definition.isErrorOutput(result.output),
      error: definition.isErrorOutput(result.output),
    })
  }
}

export function extractThinkingText(step: {
  reasoningText?: string | null
  reasoning?: Array<{ text?: string } | string> | null
}): string {
  const fromText = step.reasoningText?.trim()
  if (fromText) {
    return fromText
  }

  if (!step.reasoning?.length) {
    return ''
  }

  return step.reasoning
    .map((part) => (typeof part === 'string' ? part : (part.text ?? '')))
    .join('')
    .trim()
}

export type ExtractableAgentStep = Parameters<typeof extractAgentSteps>[0][number]
