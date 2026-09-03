import { tool } from 'ai'

import type { DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import { applyDeckEdits } from '@ark/deck/patch/text-edit.ts'
import {
  deckEditInputSchema,
  deckElementPatchInputSchema,
  deckSlidePatchInputSchema,
  deckWriteInputSchema,
} from '../tool-schemas.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import { type DeckWorkspace, setDeckWorkspaceHtml } from '../workspace.ts'
import { appendWarnings, collectValidationWarnings, rejectThemeMismatch } from './helpers.ts'

type MutateOptions = {
  logger?: Logger
  expectedTheme?: DeckThemeSpecV1 | null
}

async function executeWriteDeck(
  workspace: DeckWorkspace,
  html: string,
  expectedTheme: DeckThemeSpecV1 | null,
  timingOptions: { logger?: Logger },
) {
  const validation = validateDeckHtmlOnServer(html, timingOptions)
  if (!validation.valid) {
    const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
    return {
      ok: false,
      error: primaryIssue?.message ?? 'HTML failed Ark deck validation.',
      validation,
    }
  }
  const themeError = rejectThemeMismatch(html, expectedTheme)
  if (themeError) return themeError
  setDeckWorkspaceHtml(workspace, html)
  const warnings = collectValidationWarnings(validation)
  return {
    ok: true,
    slideCount: validation.slideCount,
    warnings,
    message: appendWarnings(`Wrote complete deck (${validation.slideCount} slide(s)).`, warnings),
  }
}

async function executeEditDeck(
  workspace: DeckWorkspace,
  edits: Parameters<typeof applyDeckEdits>[1],
  expectedTheme: DeckThemeSpecV1 | null,
  timingOptions: { logger?: Logger },
) {
  if (!workspace.html.trim()) {
    return {
      ok: false,
      error: 'No deck HTML is loaded yet. Use write_deck to create one first.',
    }
  }
  const applied = applyDeckEdits(workspace.html, edits)
  if (!applied.ok) {
    return { ok: false, error: applied.error }
  }
  const validation = validateDeckHtmlOnServer(applied.html, timingOptions)
  if (!validation.valid) {
    const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
    return {
      ok: false,
      error:
        primaryIssue?.message ??
        'Applied edits produced invalid deck HTML. Fix the patch and try again.',
      validation,
    }
  }
  const themeError = rejectThemeMismatch(applied.html, expectedTheme)
  if (themeError) return themeError
  setDeckWorkspaceHtml(workspace, applied.html)
  const warnings = collectValidationWarnings(validation)
  return {
    ok: true,
    appliedCount: applied.appliedCount,
    slideCount: validation.slideCount,
    warnings,
    message: appendWarnings(
      `Applied ${applied.appliedCount} edit(s). Deck now has ${validation.slideCount} slide(s).`,
      warnings,
    ),
  }
}

export function createMutateDeckTools(workspace: DeckWorkspace, options: MutateOptions) {
  const { logger, expectedTheme = null } = options
  const timingOptions = logger ? { logger } : {}

  return {
    write_deck: tool({
      description:
        'Replace the entire deck HTML. Use only for new decks or when the user explicitly asks for a full rewrite.',
      inputSchema: deckWriteInputSchema,
      execute: async ({ html }) => executeWriteDeck(workspace, html, expectedTheme, timingOptions),
    }),

    edit_deck: tool({
      description:
        'Apply exact search/replace patches to the deck. Each oldText must match exactly once in the original file. Prefer patch_deck for slide operations; use this for small inline HTML tweaks.',
      inputSchema: deckEditInputSchema,
      execute: async ({ edits }) => executeEditDeck(workspace, edits, expectedTheme, timingOptions),
    }),

    patch_deck: tool({
      description:
        'Apply structured slide-level patch operations (add, delete, replace, reorder, title, notes). Prefer this over edit_deck or write_deck for slide changes. Call list_slides or parse_deck first to get indexes and slide ids.',
      inputSchema: deckSlidePatchInputSchema,
      execute: async ({ operations, activeSlideIndex }) =>
        runStructuredPatch(workspace, operations, activeSlideIndex, expectedTheme, logger, {
          invalidMessage:
            'Applied patches produced invalid deck HTML. Fix the operation and try again.',
        }),
    }),

    patch_element: tool({
      description:
        'Apply element-level patch operations targeting elements by id (replace_text, set_attrs, set_inline_style, move_element, resize_element, reorder_element, duplicate_element, delete_element, insert_element, lock_element, unlock_element). Prefer this for the element the user selected. Call parse_deck first to get element ids, kinds, and locked/managed flags. Locked elements cannot be changed. If a selected element id is missing (stale) or locked, inspect the deck and pick the closest match or explain what can and cannot change instead of failing.',
      inputSchema: deckElementPatchInputSchema,
      execute: async ({ operations, activeSlideIndex }) =>
        runStructuredPatch(workspace, operations, activeSlideIndex, expectedTheme, logger, {
          invalidMessage:
            'Applied element patches produced invalid deck HTML. Fix the operation and try again.',
          includeChangedElementIds: true,
        }),
    }),
  }
}

async function runStructuredPatch(
  workspace: DeckWorkspace,
  operations: Parameters<
    Awaited<typeof import('@ark/deck-node/patch/slide-ops.ts')>['applyDeckPatches']
  >[1],
  activeSlideIndex: number | undefined,
  expectedTheme: DeckThemeSpecV1 | null,
  logger: Logger | undefined,
  options: { invalidMessage: string; includeChangedElementIds?: boolean },
) {
  if (!workspace.html.trim()) {
    return {
      ok: false,
      error: 'No deck HTML is loaded yet. Use write_deck to create one first.',
    }
  }

  const { applyDeckPatches } = await import('@ark/deck-node/patch/slide-ops.ts')
  const patched = applyDeckPatches(workspace.html, operations, { activeSlideIndex, logger })
  if (!patched.ok) {
    return { ok: false, error: patched.error, operationIndex: patched.operationIndex }
  }

  const timingOptions = logger ? { logger } : {}
  const validation = patched.validation ?? validateDeckHtmlOnServer(patched.html, timingOptions)
  if (!validation.valid) {
    const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
    return {
      ok: false,
      error: primaryIssue?.message ?? options.invalidMessage,
      validation,
      operationIndex: patched.appliedCount,
    }
  }

  const themeError = rejectThemeMismatch(patched.html, expectedTheme)
  if (themeError) return themeError

  setDeckWorkspaceHtml(workspace, patched.html)
  const warnings = collectValidationWarnings(validation)
  return {
    ok: true,
    appliedCount: patched.appliedCount,
    slideCount: validation.slideCount,
    changedSlideIndexes: patched.changedSlideIndexes,
    suggestedActiveSlideIndex: patched.suggestedActiveSlideIndex,
    ...(options.includeChangedElementIds ? { changedElementIds: patched.changedElementIds } : {}),
    summary: patched.summary,
    warnings,
    message: appendWarnings(patched.summary, warnings),
  }
}
