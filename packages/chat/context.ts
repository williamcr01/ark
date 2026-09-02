import {
  deckThemeFontPairingSchema,
  parseDeckThemeSpec,
  type DeckThemeFontPairing,
  type DeckThemeSpecV1,
} from '@ark/deck/document/theme.ts'

/** Max elements in one same-slide editor multi-select (issue #248). */
export const MAX_EDITOR_SELECTIONS = 32

/** Same-slide v1: the array's first item wins; singular is only used when the array is empty. */
export function editorSelectionFieldsSlideIndex(input: {
  editorSelection?: { slideIndex: number }
  editorSelections?: Array<{ slideIndex: number }>
}): number | undefined {
  if (input.editorSelections && input.editorSelections.length > 0) {
    return input.editorSelections[0]!.slideIndex
  }
  return input.editorSelection?.slideIndex
}

/**
 * Manual-editor selection forwarded with a generation request (issue #83). Lets
 * the agent resolve "this"/"the selected element" to a concrete element id and
 * prefer id-based patches over full-document rewrites.
 */
export type EditorSelectionContext = {
  slideIndex: number
  slideId?: string
  elementId: string
  elementKind?: string
  elementRole?: string
  textPreview?: string
  locked?: boolean
  managed?: boolean
}

/**
 * Slide(s) the user attached as chat context so the agent can focus reads/edits
 * on those slides.
 */
export type SlideContext = {
  slideIndex: number
  slideId?: string
  title?: string
}

/** Structured theme choice attached to the user turn that picks a proposal. */
export type ThemeSelectionContext = {
  themeId: string
  name: string
  fonts: DeckThemeFontPairing
  theme: DeckThemeSpecV1
}

/** Optional context attached to a user chat turn. */
export type ChatMessageContext = {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
  slideContexts?: SlideContext[]
  themeSelection?: ThemeSelectionContext
}

/**
 * Context policy: every generation request replays the full visible
 * conversation. Durable assistant turns retain every logical step using bounded,
 * recoverable tool projections. Mutations are never recommended for replay.
 * Model context is assembled separately and may summarize older steps in a
 * prefixed user-context ledger without mutating persisted chat.
 * The AI SDK owns tool-result continuation within a single generation job.
 * Compaction, branch summaries, steer queues, and follow-up queues are not implemented.
 */
export const CHAT_CONTEXT_POLICY = {
  replayFullHistory: true,
  includeCurrentHtml: true,
  assistantMessagesExcludeHtml: true,
  replayAssistantToolTranscript: true,
} as const

function parseEditorSelectionItem(
  input: unknown,
  path: string,
): { ok: true; selection: EditorSelectionContext } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${path} must be an object.` }
  }
  const slideIndex = (input as { slideIndex?: unknown }).slideIndex
  const elementId = (input as { elementId?: unknown }).elementId
  if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex) || slideIndex < 0) {
    return { ok: false, error: `${path}.slideIndex must be a non-negative integer.` }
  }
  if (typeof elementId !== 'string' || elementId.trim().length === 0) {
    return { ok: false, error: `${path}.elementId must be a string.` }
  }
  const editorSelection: EditorSelectionContext = {
    slideIndex,
    elementId: elementId.trim(),
  }
  const slideId = (input as { slideId?: unknown }).slideId
  if (typeof slideId === 'string' && slideId.trim()) {
    editorSelection.slideId = slideId.trim()
  }
  const elementKind = (input as { elementKind?: unknown }).elementKind
  if (typeof elementKind === 'string' && elementKind.trim()) {
    editorSelection.elementKind = elementKind.trim()
  }
  const elementRole = (input as { elementRole?: unknown }).elementRole
  if (typeof elementRole === 'string' && elementRole.trim()) {
    editorSelection.elementRole = elementRole.trim()
  }
  const textPreview = (input as { textPreview?: unknown }).textPreview
  if (typeof textPreview === 'string' && textPreview.trim()) {
    editorSelection.textPreview = textPreview.trim().slice(0, 280)
  }
  if (typeof (input as { locked?: unknown }).locked === 'boolean') {
    editorSelection.locked = (input as { locked: boolean }).locked
  }
  if (typeof (input as { managed?: unknown }).managed === 'boolean') {
    editorSelection.managed = (input as { managed: boolean }).managed
  }
  return { ok: true, selection: editorSelection }
}

/**
 * Canonical editor-selection fields for jobs and chat context.
 * One element populates both singular and array. Multiple: array is the full
 * same-slide set; singular is the primary / last-interacted element. Mixed
 * slideIndex values are dropped (same-slide v1) rather than crashing.
 */
export function normalizeEditorSelectionFields(input: {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
}): { editorSelection?: EditorSelectionContext; editorSelections?: EditorSelectionContext[] } {
  const primary = input.editorSelection
  const raw = input.editorSelections?.length ? input.editorSelections : primary ? [primary] : []
  if (raw.length === 0) return {}

  const slideIndex = editorSelectionFieldsSlideIndex(input)
  if (slideIndex === undefined) return {}

  const seen = new Set<string>()
  const sameSlide: EditorSelectionContext[] = []
  for (const item of raw) {
    if (item.slideIndex !== slideIndex) continue
    if (seen.has(item.elementId)) continue
    seen.add(item.elementId)
    sameSlide.push(item)
    if (sameSlide.length >= MAX_EDITOR_SELECTIONS) break
  }

  if (
    primary &&
    primary.slideIndex === slideIndex &&
    !seen.has(primary.elementId) &&
    sameSlide.length < MAX_EDITOR_SELECTIONS
  ) {
    sameSlide.unshift(primary)
  }

  if (sameSlide.length === 0) return {}

  const resolvedPrimary =
    primary && sameSlide.some((item) => item.elementId === primary.elementId)
      ? sameSlide.find((item) => item.elementId === primary.elementId)!
      : sameSlide[sameSlide.length - 1]!

  return {
    editorSelection: resolvedPrimary,
    editorSelections: sameSlide,
  }
}

function parseThemeSelectionContext(
  input: unknown,
  path: string,
): { ok: true; selection: ThemeSelectionContext } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${path} must be an object.` }
  }
  const record = input as {
    themeId?: unknown
    name?: unknown
    fonts?: unknown
    theme?: unknown
  }
  if (typeof record.themeId !== 'string' || !record.themeId.trim()) {
    return { ok: false, error: `${path}.themeId must be a non-empty string.` }
  }
  if (typeof record.name !== 'string' || !record.name.trim()) {
    return { ok: false, error: `${path}.name must be a non-empty string.` }
  }
  const fonts = deckThemeFontPairingSchema.safeParse(record.fonts)
  if (!fonts.success) {
    return { ok: false, error: `${path}.fonts must be an approved display/body/mono pairing.` }
  }
  const theme = parseDeckThemeSpec(record.theme)
  if (!theme) {
    return { ok: false, error: `${path}.theme must be a valid DeckThemeSpecV1.` }
  }
  return {
    ok: true,
    selection: {
      themeId: record.themeId.trim(),
      name: record.name.trim().slice(0, 80),
      fonts: fonts.data,
      theme,
    },
  }
}

export function parseChatMessageContext(
  input: unknown,
  messageIndex: number,
): { ok: true; context?: ChatMessageContext } | { ok: false; error: string } {
  if (input === undefined) {
    return { ok: true }
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: `messages[${messageIndex}].context must be an object.`,
    }
  }

  const record = input as {
    editorSelection?: unknown
    editorSelections?: unknown
    slideContexts?: unknown
    themeSelection?: unknown
  }
  const context: ChatMessageContext = {}

  let editorSelection: EditorSelectionContext | undefined
  if (record.editorSelection !== undefined) {
    const parsed = parseEditorSelectionItem(
      record.editorSelection,
      `messages[${messageIndex}].context.editorSelection`,
    )
    if (!parsed.ok) return parsed
    editorSelection = parsed.selection
  }

  let editorSelections: EditorSelectionContext[] | undefined
  if (record.editorSelections !== undefined) {
    if (!Array.isArray(record.editorSelections)) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.editorSelections must be an array.`,
      }
    }
    if (record.editorSelections.length > MAX_EDITOR_SELECTIONS) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.editorSelections exceeds the ${MAX_EDITOR_SELECTIONS} element limit.`,
      }
    }
    const parsedSelections: EditorSelectionContext[] = []
    for (const [offset, item] of record.editorSelections.entries()) {
      const parsed = parseEditorSelectionItem(
        item,
        `messages[${messageIndex}].context.editorSelections[${offset}]`,
      )
      if (!parsed.ok) return parsed
      parsedSelections.push(parsed.selection)
    }
    editorSelections = parsedSelections
  }

  const normalized = normalizeEditorSelectionFields({ editorSelection, editorSelections })
  if (normalized.editorSelection) {
    context.editorSelection = normalized.editorSelection
  }
  if (normalized.editorSelections?.length) {
    context.editorSelections = normalized.editorSelections
  }

  if (record.slideContexts !== undefined) {
    if (!Array.isArray(record.slideContexts)) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.slideContexts must be an array.`,
      }
    }
    if (record.slideContexts.length > 64) {
      return {
        ok: false,
        error: `messages[${messageIndex}].context.slideContexts exceeds the 64 slide limit.`,
      }
    }
    const slideContexts: SlideContext[] = []
    for (const [slideOffset, item] of record.slideContexts.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return {
          ok: false,
          error: `messages[${messageIndex}].context.slideContexts[${slideOffset}] must be an object.`,
        }
      }
      const slideIndex = (item as { slideIndex?: unknown }).slideIndex
      if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex) || slideIndex < 0) {
        return {
          ok: false,
          error: `messages[${messageIndex}].context.slideContexts[${slideOffset}].slideIndex must be a non-negative integer.`,
        }
      }
      const slide: SlideContext = { slideIndex }
      const slideId = (item as { slideId?: unknown }).slideId
      if (typeof slideId === 'string' && slideId.trim()) {
        slide.slideId = slideId.trim()
      }
      const title = (item as { title?: unknown }).title
      if (typeof title === 'string' && title.trim()) {
        slide.title = title.trim().slice(0, 200)
      }
      slideContexts.push(slide)
    }
    if (slideContexts.length > 0) {
      context.slideContexts = slideContexts
    }
  }

  if (record.themeSelection !== undefined) {
    const parsedTheme = parseThemeSelectionContext(
      record.themeSelection,
      `messages[${messageIndex}].context.themeSelection`,
    )
    if (!parsedTheme.ok) return parsedTheme
    context.themeSelection = parsedTheme.selection
  }

  if (
    !context.editorSelection &&
    !context.editorSelections?.length &&
    !context.slideContexts?.length &&
    !context.themeSelection
  ) {
    return { ok: true }
  }

  return { ok: true, context }
}

/** Factual one-line description of a selected editor element. */
export function describeEditorSelectionLine(selection: EditorSelectionContext): string {
  const descriptors: string[] = []

  if (selection.elementKind) {
    descriptors.push(selection.elementKind)
  }

  if (selection.elementRole && selection.elementRole !== selection.elementKind) {
    descriptors.push(selection.elementRole)
  }

  const descriptor = descriptors.length > 0 ? ` (${descriptors.join(', ')})` : ''
  const slideRef = selection.slideId
    ? `slide ${selection.slideIndex} (slide id "${selection.slideId}")`
    : `slide ${selection.slideIndex}`
  const textNote = selection.textPreview ? `, text: "${selection.textPreview}"` : ''

  const statuses: string[] = []
  if (selection.locked) {
    statuses.push('locked')
  }
  if (selection.managed) {
    statuses.push('Ark-managed')
  }
  const statusNote = statuses.length > 0 ? ` It is ${statuses.join(' and ')}.` : ''

  return `id "${selection.elementId}"${descriptor} on ${slideRef}${textNote}.${statusNote}`
}

/** Factual one-line description of an attached slide. */
export function describeOneSlideContext(slide: SlideContext): string {
  const titleNote = slide.title ? ` ("${slide.title}")` : ''
  const idNote = slide.slideId ? `, slide id "${slide.slideId}"` : ''
  return `slide ${slide.slideIndex}${titleNote}${idNote}`
}
