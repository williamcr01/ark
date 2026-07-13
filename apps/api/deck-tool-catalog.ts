import { createHash } from 'node:crypto'

import type { JsonValue } from '@ark/deck-core/chat.ts'
import {
  MAX_TRANSCRIPT_TURN_CHARS,
  MAX_TRANSCRIPT_VALUE_CHARS,
  type ChatMessagePart,
} from '@ark/deck-core/chat.ts'
import type { Logger } from './observability/logger.ts'
import { createDeckTools, type DeckVersionInspector } from './deck-tools.ts'
import type { DeckWorkspace } from './deck-workspace.ts'

export type DeckToolDefinition = {
  name: string
  snippet: string
  description: string
  guidelines: readonly string[]
  summarizeInput: (input: unknown) => string
  summarizeOutput: (output: unknown) => string
  isErrorOutput: (output: unknown) => boolean
  projectInputForTranscript: (input: unknown) => JsonValue
  projectOutputForTranscript: (output: unknown) => JsonValue
}

export const transcriptHtmlMarker = (html: string) =>
  `[deck HTML omitted: ${html.length} characters, sha256:${createHash('sha256').update(html).digest('hex')}; re-read the current deck with read_deck]`

const truncateString = (value: string) => {
  if (value.length <= 4_000) return value
  return `${value.slice(0, 4_000)}[... ${value.length - 4_000} characters omitted; re-read the current deck if needed]`
}

export function normalizeTranscriptValue(value: unknown, key = ''): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string') {
      if (key === 'html' || /<!doctype html|<html[\s>]/i.test(value))
        return transcriptHtmlMarker(value)
      return truncateString(value)
    }
    return value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (Array.isArray(value)) return value.map((item) => normalizeTranscriptValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeTranscriptValue(entryValue, entryKey),
      ]),
    )
  }
  return String(value)
}

export function capTranscriptValue(value: JsonValue): JsonValue {
  const serialized = JSON.stringify(value)
  return serialized.length <= MAX_TRANSCRIPT_VALUE_CHARS
    ? value
    : {
        omitted: true,
        originalCharacters: serialized.length,
        reason: 'Transcript value exceeded limit; re-read the current deck.',
      }
}

export function capTranscriptParts(parts: readonly ChatMessagePart[]): ChatMessagePart[] {
  const keptSteps: ChatMessagePart[][] = []
  const steps = new Map<number, ChatMessagePart[]>()
  for (const part of parts)
    steps.set(part.stepIndex ?? -1, [...(steps.get(part.stepIndex ?? -1) ?? []), part])
  const orderedSteps = [...steps].sort(([a], [b]) => a - b)
  for (const [stepIndex, stepParts] of orderedSteps.toReversed()) {
    const omittedAfterAdding = orderedSteps.length - keptSteps.length - 1
    const marker =
      omittedAfterAdding > 0 ? transcriptOmissionMarker(omittedAfterAdding, stepIndex) : null
    const reservedSize = JSON.stringify([...(marker ? [marker] : []), ...keptSteps.flat()]).length
    const compactedStep =
      keptSteps.length === 0
        ? compactTranscriptStep(stepParts, MAX_TRANSCRIPT_TURN_CHARS - reservedSize)
        : stepParts
    if (
      JSON.stringify([...(marker ? [marker] : []), ...compactedStep, ...keptSteps.flat()]).length >
      MAX_TRANSCRIPT_TURN_CHARS
    )
      break
    keptSteps.unshift(compactedStep)
    if (compactedStep !== stepParts && omittedAfterAdding > 0) break
  }

  const omittedStepCount = orderedSteps.length - keptSteps.length
  if (omittedStepCount === 0) return keptSteps.flat()

  const firstStepIndex = keptSteps[0]?.[0]?.stepIndex ?? 1
  return [transcriptOmissionMarker(omittedStepCount, firstStepIndex), ...keptSteps.flat()]
}

function transcriptOmissionMarker(omittedStepCount: number, firstStepIndex: number) {
  return {
    type: 'text',
    stepIndex: Math.max(0, firstStepIndex - 1),
    content: `[${omittedStepCount} earlier transcript step(s) omitted to retain the most recent agent state; re-read the current deck as needed]`,
  } satisfies ChatMessagePart
}

function compactTranscriptStep(parts: ChatMessagePart[], maxChars: number): ChatMessagePart[] {
  if (JSON.stringify(parts).length <= maxChars) return parts

  const omittedValue = {
    omitted: true,
    reason: 'Transcript step exceeded limit; re-read the current deck.',
  } as const
  return parts.map((part) => {
    if (part.type === 'tool-call') return { ...part, input: omittedValue }
    if (part.type === 'tool-result') return { ...part, output: omittedValue }
    return {
      ...part,
      content:
        '[assistant text omitted because this transcript step exceeded the replay limit; re-read the current deck as needed]',
    }
  })
}

const summarizeInput = (toolName: string, input: unknown) => {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (toolName === 'read_deck')
    return typeof record.slideIndex === 'number'
      ? `slide ${record.slideIndex}`
      : `lines ${typeof record.offset === 'number' ? record.offset : 1}-${typeof record.limit === 'number' ? record.limit : 'default'}`
  if (toolName === 'edit_deck')
    return `${Array.isArray(record.edits) ? record.edits.length : 0} patch(es)`
  if (toolName === 'patch_deck' || toolName === 'patch_element')
    return `${Array.isArray(record.operations) ? record.operations.length : 0} op(s)`
  if (toolName === 'write_deck') return 'full deck'
  if (toolName === 'list_versions')
    return `${typeof record.limit === 'number' ? record.limit : 10} version(s)`
  return 'outline'
}

const summarizeOutput = (toolName: string, output: unknown) => {
  const record = output && typeof output === 'object' ? (output as Record<string, unknown>) : {}
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  if (typeof record.summary === 'string') return record.summary
  if (toolName === 'list_versions')
    return `${typeof record.versionCount === 'number' ? record.versionCount : 0} version(s)`
  if (toolName === 'read_deck')
    return record.mode === 'slide' && typeof record.title === 'string'
      ? record.title
      : `${typeof record.totalLines === 'number' ? record.totalLines : '?'} lines`
  if (toolName === 'list_slides' || toolName === 'parse_deck')
    return `${typeof record.slideCount === 'number' ? record.slideCount : 0} slide(s)`
  if (typeof record.appliedCount === 'number') return `Applied ${record.appliedCount} operation(s)`
  if (typeof record.slideCount === 'number') return `${record.slideCount} slide(s) written`
  return 'Done'
}

const metadata = {
  parse_deck: {
    snippet: 'parse_deck()',
    guidelines: [
      'Use parse_deck to understand deck structure and editable element ids before targeted edits.',
    ],
  },
  list_slides: {
    snippet: 'list_slides()',
    guidelines: ['Use list_slides before slide-level changes.'],
  },
  read_deck: {
    snippet: 'read_deck({ slideIndex }) or read_deck({ offset, limit })',
    guidelines: ['Re-read current deck content when transcript markers say content was omitted.'],
  },
  edit_deck: {
    snippet: 'edit_deck({ edits })',
    guidelines: ['Use edit_deck only for small exact inline replacements.'],
  },
  patch_deck: {
    snippet: 'patch_deck({ operations })',
    guidelines: ['Prefer patch_deck for slide changes.'],
  },
  patch_element: {
    snippet: 'patch_element({ operations })',
    guidelines: ['Prefer patch_element for a selected element id.'],
  },
  write_deck: {
    snippet: 'write_deck({ html })',
    guidelines: ['Use write_deck only for new decks or explicit full rewrites.'],
  },
  list_versions: {
    snippet: 'list_versions({ limit })',
    guidelines: ['Use list_versions before large rewrites or when asked what changed.'],
  },
} as const

export function createActiveDeckTools(
  workspace: DeckWorkspace,
  options: { logger?: Logger; versionInspector?: DeckVersionInspector } = {},
) {
  const rawTools = createDeckTools(workspace, options)
  const activeDefinitions = Object.entries(rawTools).map(([name, registeredTool]) => {
    const info = metadata[name as keyof typeof metadata]
    return {
      name,
      snippet: info.snippet,
      description: registeredTool.description ?? '',
      guidelines: info.guidelines,
      summarizeInput: (input: unknown) => summarizeInput(name, input),
      summarizeOutput: (output: unknown) => summarizeOutput(name, output),
      isErrorOutput: (output: unknown) =>
        !!output &&
        typeof output === 'object' &&
        ('error' in output || ('ok' in output && output.ok === false)),
      projectInputForTranscript: (input: unknown) =>
        capTranscriptValue(normalizeTranscriptValue(input)),
      projectOutputForTranscript: (output: unknown) =>
        capTranscriptValue(normalizeTranscriptValue(output)),
    } satisfies DeckToolDefinition
  })
  return { tools: rawTools, activeDefinitions }
}

export function findToolDefinition(definitions: readonly DeckToolDefinition[], name: string) {
  return definitions.find((definition) => definition.name === name)
}
