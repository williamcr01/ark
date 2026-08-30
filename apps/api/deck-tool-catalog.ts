import { createHash } from 'node:crypto'

import { THEME_SAMPLE_HTML_MAX_BYTES } from '@ark/chat/agent-themes.ts'
import { MAX_PERSISTED_TOOL_VALUE_BYTES, type JsonValue } from '@ark/chat/chat.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import { createDeckTools, type DeckAttachmentInspector } from './deck-tools.ts'
import type { DeckWorkspace } from './deck-workspace.ts'

export type DeckToolDefinition = {
  name: string
  snippet: string
  description: string
  summarizeInput: (input: unknown) => string
  summarizeOutput: (output: unknown) => string
  isErrorOutput: (output: unknown) => boolean
  mutating: boolean
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

const truncateString = (value: string, limit = 4_000) => {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}[... ${value.length - limit} characters omitted; re-read the current deck if needed]`
}

export function normalizeTranscriptValue(
  value: unknown,
  key = '',
  stringLimit = 4_000,
  arrayLimit = Number.POSITIVE_INFINITY,
): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string') {
      if (key === 'html' || /<!doctype html|<html[\s>]/i.test(value))
        return transcriptHtmlMarker(value)
      return truncateString(value, stringLimit)
    }
    return value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (Array.isArray(value)) {
    const projected = value
      .slice(0, arrayLimit)
      .map((item) => normalizeTranscriptValue(item, '', stringLimit, arrayLimit))
    if (value.length > arrayLimit)
      projected.push({ omittedItems: value.length - arrayLimit } as JsonValue)
    return projected
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeTranscriptValue(entryValue, entryKey, stringLimit, arrayLimit),
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
  if (toolName === 'ask_user')
    return `${Array.isArray(record.questions) ? record.questions.length : 0} question(s)`
  if (toolName === 'propose_themes')
    return `${Array.isArray(record.themes) ? record.themes.length : 0} theme(s)`
  if (toolName === 'read_deck')
    return typeof record.slideIndex === 'number'
      ? `slide ${record.slideIndex}`
      : `lines ${typeof record.offset === 'number' ? record.offset : 1}-${typeof record.limit === 'number' ? record.limit : 'default'}`
  if (toolName === 'edit_deck')
    return `${Array.isArray(record.edits) ? record.edits.length : 0} patch(es)`
  if (toolName === 'patch_deck' || toolName === 'patch_element')
    return `${Array.isArray(record.operations) ? record.operations.length : 0} op(s)`
  if (toolName === 'write_deck') return 'full deck'
  return 'outline'
}

const summarizeOutput = (toolName: string, output: unknown) => {
  const record = output && typeof output === 'object' ? (output as Record<string, unknown>) : {}
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  if (typeof record.summary === 'string') return record.summary
  if (toolName === 'ask_user') return 'Waiting for user answers'
  if (toolName === 'propose_themes') return 'Waiting for theme choice'
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

const utf8Prefix = (value: string, maxBytes: number) => {
  let content = ''
  let characters = 0
  let used = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (used + size > maxBytes) break
    content += character
    used += size
    characters += 1
  }
  return { content, characters }
}

const recoveryValue = (
  record: Record<string, JsonValue>,
  recovery: TranscriptProjection['recovery'],
) => (recovery ? { ...record, transcriptRecovery: recovery } : record)

function projectReadOutput(value: unknown): TranscriptProjection {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const record = asRecord(normalizeTranscriptValue({ ...source, content: undefined }))
  delete record.content
  const rawContent = typeof source.content === 'string' ? source.content : ''
  const page = utf8Prefix(rawContent, 40 * 1024)
  const contentWasProjected = page.content !== rawContent
  if (rawContent) record.content = page.content
  const nextOffset = typeof source.nextOffset === 'number' ? source.nextOffset : undefined
  const nextCharOffset =
    typeof source.nextCharOffset === 'number' ? source.nextCharOffset : undefined
  const offset = typeof source.offset === 'number' ? source.offset : 1
  const slideIndex = typeof source.index === 'number' ? source.index : undefined
  const currentCharOffset = typeof source.charOffset === 'number' ? source.charOffset : 0
  const recoveryInput: JsonValue | undefined = contentWasProjected
    ? slideIndex !== undefined
      ? { slideIndex, charOffset: currentCharOffset + page.characters }
      : rawContent.includes('\n')
        ? { offset }
        : { offset, charOffset: currentCharOffset + page.characters }
    : nextCharOffset !== undefined
      ? slideIndex !== undefined
        ? { slideIndex, charOffset: nextCharOffset }
        : { offset, charOffset: nextCharOffset }
      : nextOffset
        ? { offset: nextOffset }
        : undefined
  const recovery = recoveryInput
    ? {
        toolName: 'read_deck',
        input: recoveryInput,
        instruction: `Call read_deck(${JSON.stringify(recoveryInput)}) to continue.`,
      }
    : undefined
  const truncated = contentWasProjected || source.truncated === true
  return { value: capTranscriptValue(recoveryValue(record, recovery)), truncated, recovery }
}

function projectMutation(toolName: string, value: unknown): TranscriptProjection {
  const projected = capTranscriptValue(normalizeTranscriptValue(value, '', 256, 20))
  const recovery = {
    toolName: 'read_deck',
    input: {},
    instruction: `Do not repeat ${toolName}; inspect the current deck to verify its effect.`,
  }
  const record = asRecord(projected)
  return {
    value: capTranscriptValue(recoveryValue(record, recovery)),
    truncated: JSON.stringify(projected) !== JSON.stringify(normalizeTranscriptValue(value)),
    recovery,
  }
}

function projectReadOnly(toolName: string, value: unknown): TranscriptProjection {
  const projected = normalizeTranscriptValue(value, '', 256, 20)
  const capped = capTranscriptValue(projected)
  const truncated = JSON.stringify(capped) !== JSON.stringify(projected)
  const recovery = truncated
    ? { toolName, input: {}, instruction: `Call ${toolName} again to recover current data.` }
    : undefined
  return {
    value: recoveryValue(asRecord(capped), recovery),
    truncated,
    recovery,
  }
}

/** Preserve lean sampleHtml for client theme previews (default projector strips HTML). */
function projectProposeThemesInput(value: unknown): TranscriptProjection {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const themes = Array.isArray(source.themes) ? source.themes : []
  let sampleTruncated = false
  const projectedThemes = themes.slice(0, 4).map((theme) => {
    if (!theme || typeof theme !== 'object') return theme as JsonValue
    const record = theme as Record<string, unknown>
    const sampleHtml = typeof record.sampleHtml === 'string' ? record.sampleHtml : ''
    const page = utf8Prefix(sampleHtml, THEME_SAMPLE_HTML_MAX_BYTES)
    if (page.content !== sampleHtml) sampleTruncated = true
    return {
      id: typeof record.id === 'string' ? record.id : '',
      name: typeof record.name === 'string' ? truncateString(record.name, 80) : '',
      description:
        typeof record.description === 'string' ? truncateString(record.description, 200) : '',
      sampleHtml: page.content,
    }
  })
  const projected = {
    title: typeof source.title === 'string' ? truncateString(source.title, 120) : '',
    themes: projectedThemes,
  } as JsonValue
  const capped = capTranscriptValue(projected)
  const truncated = sampleTruncated || JSON.stringify(capped) !== JSON.stringify(projected)
  return { value: capped, truncated }
}

const metadata = {
  parse_deck: {
    mutating: false,
    snippet: 'parse_deck()',
  },
  list_slides: {
    mutating: false,
    snippet: 'list_slides()',
  },
  read_deck: {
    mutating: false,
    snippet: 'read_deck({ slideIndex }) or read_deck({ offset, limit })',
  },
  edit_deck: {
    mutating: true,
    snippet: 'edit_deck({ edits })',
  },
  patch_deck: {
    mutating: true,
    snippet: 'patch_deck({ operations })',
  },
  patch_element: {
    mutating: true,
    snippet: 'patch_element({ operations })',
  },
  write_deck: {
    mutating: true,
    snippet: 'write_deck({ html })',
  },
  list_attachments: {
    mutating: false,
    snippet: 'list_attachments()',
  },
  read_attachment: {
    mutating: false,
    snippet: 'read_attachment({ id, offset, limit })',
  },
  ask_user: {
    mutating: false,
    snippet: 'ask_user({ title, description, questions })',
  },
  propose_themes: {
    mutating: false,
    snippet: 'propose_themes({ title, themes })',
  },
} as const

const transcriptProjectors = {
  parse_deck: {
    input: (value: unknown) => projectReadOnly('parse_deck', value),
    output: (value: unknown) => projectReadOnly('parse_deck', value),
  },
  list_slides: {
    input: (value: unknown) => projectReadOnly('list_slides', value),
    output: (value: unknown) => projectReadOnly('list_slides', value),
  },
  read_deck: {
    input: (value: unknown) => projectReadOnly('read_deck', value),
    output: projectReadOutput,
  },
  edit_deck: {
    input: (value: unknown) => projectMutation('edit_deck', value),
    output: (value: unknown) => projectMutation('edit_deck', value),
  },
  patch_deck: {
    input: (value: unknown) => projectMutation('patch_deck', value),
    output: (value: unknown) => projectMutation('patch_deck', value),
  },
  patch_element: {
    input: (value: unknown) => projectMutation('patch_element', value),
    output: (value: unknown) => projectMutation('patch_element', value),
  },
  write_deck: {
    input: (value: unknown) => projectMutation('write_deck', value),
    output: (value: unknown) => projectMutation('write_deck', value),
  },
  list_attachments: {
    input: (value: unknown) => projectReadOnly('list_attachments', value),
    output: (value: unknown) => projectReadOnly('list_attachments', value),
  },
  read_attachment: {
    input: (value: unknown) => projectReadOnly('read_attachment', value),
    output: (value: unknown) => projectReadOnly('read_attachment', value),
  },
  ask_user: {
    input: (value: unknown) => projectReadOnly('ask_user', value),
    output: (value: unknown) => projectReadOnly('ask_user', value),
  },
  propose_themes: {
    input: projectProposeThemesInput,
    output: (value: unknown) => projectReadOnly('propose_themes', value),
  },
} satisfies Record<
  keyof typeof metadata,
  {
    input: (value: unknown) => TranscriptProjection
    output: (value: unknown) => TranscriptProjection
  }
>

export function createActiveDeckTools(
  workspace: DeckWorkspace,
  options: {
    logger?: Logger
    attachmentInspector?: DeckAttachmentInspector
  } = {},
) {
  const rawTools = createDeckTools(workspace, options)
  const activeDefinitions = Object.entries(rawTools).map(([name, registeredTool]) => {
    const info = metadata[name as keyof typeof metadata]
    const projectors = transcriptProjectors[name as keyof typeof transcriptProjectors]
    return {
      name,
      snippet: info.snippet,
      description: registeredTool.description ?? '',
      mutating: info.mutating,
      summarizeInput: (input: unknown) => summarizeInput(name, input),
      summarizeOutput: (output: unknown) => summarizeOutput(name, output),
      isErrorOutput: (output: unknown) =>
        !!output &&
        typeof output === 'object' &&
        ('error' in output || ('ok' in output && output.ok === false)),
      projectInputForTranscript: projectors.input,
      projectOutputForTranscript: projectors.output,
    } satisfies DeckToolDefinition
  })
  return { tools: rawTools, activeDefinitions }
}

export function findToolDefinition(definitions: readonly DeckToolDefinition[], name: string) {
  return definitions.find((definition) => definition.name === name)
}
