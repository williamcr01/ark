import { deckOriginIsUnauthored, type DeckOrigin } from '@ark/deck/document/origin.ts'
import { formatDeckThemeSummary } from '@ark/deck/document/theme.ts'
import {
  describeEditorSelectionLine,
  describeOneSlideContext,
  normalizeEditorSelectionFields,
  type EditorSelectionContext,
  type SlideContext,
  type ThemeSelectionContext,
} from '@ark/chat/chat.ts'

function describeEditorSelection(selection: EditorSelectionContext): string {
  const lockGuidance = selection.locked
    ? ' Because it is locked, explain what can and cannot be changed or make a safe patch instead of forcing a risky edit.'
    : ''

  return `The user has an element selected in the editor. When the instruction refers to "this", "it", or "the selected element", target it.
Selected element: ${describeEditorSelectionLine(selection)}
Verify it with parse_deck or read_deck, then prefer patch_element with this elementId. If the id is missing or no longer matches (stale selection), inspect the deck and pick the closest element or ask before guessing.${lockGuidance}`
}

/** Prompt note for one or more editor selections. Lists every id; never summarizes them away. */
export function describeEditorSelections(
  selections: EditorSelectionContext[],
  primary?: EditorSelectionContext,
): string {
  if (selections.length === 0) {
    return ''
  }

  if (selections.length === 1) {
    return describeEditorSelection(selections[0]!)
  }

  const resolvedPrimary =
    primary && selections.some((item) => item.elementId === primary.elementId)
      ? primary
      : selections[selections.length - 1]!
  const listed = selections.map((item) => `- ${describeEditorSelectionLine(item)}`).join('\n')
  const anyLocked = selections.some((item) => item.locked)
  const lockGuidance = anyLocked
    ? ' Because some selected elements are locked, explain what can and cannot be changed or make a safe patch instead of forcing a risky edit.'
    : ''

  return `The user has ${selections.length} elements selected in the editor. When the instruction refers to "these", "them", or "the selected elements", target this set. The primary / last-interacted element is id "${resolvedPrimary.elementId}".
Selected elements:
${listed}
Verify each with parse_deck or read_deck, then prefer patch_element per elementId. Apply the requested change to every selected id unless the instruction names a subset. If an id is missing or no longer matches (stale selection), skip it and mention that in the reply instead of guessing.${lockGuidance}`
}

/** Prompt note for slides the user attached as chat context. */
export function describeSlideContexts(slides: SlideContext[]): string {
  if (slides.length === 0) {
    return ''
  }

  const listed = slides.map(describeOneSlideContext).join('; ')
  const focus =
    slides.length === 1
      ? `Focus reads and edits on that slide; use read_deck / patch_deck with slide index ${slides[0]!.slideIndex}.`
      : `Focus reads and edits on those slides; use read_deck / patch_deck with the listed slide indexes.`

  return `The user attached the following slide(s) as context: ${listed}.
When the instruction refers to "this slide", "these slides", or attached slide context, target them.
${focus}`
}

function describeThemeSelection(selection: ThemeSelectionContext) {
  return `The user selected a visual theme. Use this exact contract for the deck: name "${selection.name}" (id: ${selection.themeId}, signature ${selection.theme.signature}).
${formatDeckThemeSummary(selection.theme)}
Embed this spec as <script type="application/json" data-ark-theme>, materialize its --ark-* CSS variables, set data-ark-font-* markers, and classify every slide with data-ark-slide-kind and data-ark-layout matching the recipes. Do not invent a different palette or layout system.`
}

export function wrapUserPromptForAgent(
  prompt: string,
  currentHtml: string,
  attachmentCount = 0,
  editorSelection?: EditorSelectionContext,
  slideContexts?: SlideContext[],
  deckOrigin?: DeckOrigin | null,
  editorSelections?: EditorSelectionContext[],
  themeSelection?: ThemeSelectionContext,
) {
  const effectivePrompt =
    prompt.trim() ||
    (attachmentCount > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

  const attachmentNote =
    attachmentCount > 0
      ? `\n\nThe user attached ${attachmentCount} file(s). Use them as reference for content, layout, branding, or visuals.`
      : ''

  const normalized = normalizeEditorSelectionFields({ editorSelection, editorSelections })
  const selectionNote = normalized.editorSelections?.length
    ? `\n\n${describeEditorSelections(normalized.editorSelections, normalized.editorSelection)}`
    : ''
  const slideNote =
    slideContexts && slideContexts.length > 0 ? `\n\n${describeSlideContexts(slideContexts)}` : ''
  const themeNote = themeSelection ? `\n\n${describeThemeSelection(themeSelection)}` : ''

  // Ark creates the deck before the first message, so a blank starter deck has
  // HTML but nothing authored. Treat it as a new deck, not something to revise.
  if (currentHtml.trim() && !deckOriginIsUnauthored(deckOrigin)) {
    return `The user wants to revise their Ark HTML deck.

User instruction:
${effectivePrompt}${attachmentNote}${selectionNote}${slideNote}${themeNote}

The current deck is available in the job workspace. Inspect it with the available tools before editing.`
  }

  const blankDeckNote = currentHtml.trim()
    ? '\n\nThe workspace holds an empty starter deck with no authored content. Do not read or preserve it; write_deck replaces it outright.'
    : ''

  return `Create a new complete Ark HTML slide deck from this user request:

${effectivePrompt}${attachmentNote}${blankDeckNote}${themeNote}

Use the available tools to save the deck, then summarize what you built.`
}
