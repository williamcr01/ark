import { createHash } from 'node:crypto'

import { MAX_PERSISTED_TOOL_VALUE_BYTES, type JsonValue } from '@ark/deck-core/chat.ts'
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
  projectInputForTranscript: (input: unknown) => TranscriptProjection
  projectOutputForTranscript: (output: unknown) => TranscriptProjection
}

export type TranscriptProjection = {
  value: JsonValue
  truncated: boolean
  recovery?: { toolName: string; input: JsonValue; instruction: string }
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
  return Buffer.byteLength(serialized, 'utf8') <= MAX_PERSISTED_TOOL_VALUE_BYTES
    ? value
    : {
        omitted: true,
        originalBytes: Buffer.byteLength(serialized, 'utf8'),
        reason: 'Transcript value exceeded limit; re-read the current deck.',
      }
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

const asRecord = (value: JsonValue): Record<string, JsonValue> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : { value }

function projectToolValue(toolName: string, value: unknown, output: boolean): TranscriptProjection {
  const projected = normalizeTranscriptValue(value)
  const record = asRecord(projected)
  if (toolName === 'read_deck' && output) {
    const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const contentWasProjected =
      typeof source.content === 'string' &&
      typeof record.content === 'string' &&
      source.content !== record.content
    const truncated =
      contentWasProjected || record.truncated === true || typeof record.hint === 'string'
    const nextOffset = typeof record.nextOffset === 'number' ? record.nextOffset : undefined
    const nextCharOffset =
      typeof record.nextCharOffset === 'number' ? record.nextCharOffset : undefined
    const offset = typeof record.offset === 'number' ? record.offset : 1
    const slideIndex = typeof record.index === 'number' ? record.index : undefined
    const recoveryInput: JsonValue | undefined = nextCharOffset
      ? slideIndex !== undefined
        ? { slideIndex, charOffset: nextCharOffset }
        : { offset, charOffset: nextCharOffset }
      : nextOffset
        ? { offset: nextOffset }
        : contentWasProjected
          ? slideIndex !== undefined
            ? { slideIndex }
            : { offset }
          : undefined
    return {
      value: capTranscriptValue(record),
      truncated,
      ...(truncated && recoveryInput
        ? {
            recovery: {
              toolName,
              input: recoveryInput,
              instruction: `Call read_deck(${JSON.stringify(recoveryInput)}) to continue.`,
            },
          }
        : {}),
    }
  }
  const capped = capTranscriptValue(projected)
  const truncated = JSON.stringify(capped) !== JSON.stringify(projected)
  return {
    value: capped,
    truncated,
    ...(truncated
      ? {
          recovery: {
            toolName,
            input: {},
            instruction: `Call ${toolName} again to recover current data.`,
          },
        }
      : {}),
  }
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
      projectInputForTranscript: (input: unknown) => projectToolValue(name, input, false),
      projectOutputForTranscript: (output: unknown) => projectToolValue(name, output, true),
    } satisfies DeckToolDefinition
  })
  return { tools: rawTools, activeDefinitions }
}

export function findToolDefinition(definitions: readonly DeckToolDefinition[], name: string) {
  return definitions.find((definition) => definition.name === name)
}
