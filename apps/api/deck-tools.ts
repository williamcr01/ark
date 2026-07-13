import { tool } from 'ai'
import { z } from 'zod'

import { applyDeckEdits } from './deck-edit.ts'
import {
  deckElementPatchOperationSchema,
  deckSlidePatchOperationSchema,
} from '@ark/deck-core/deck-patch.ts'
import {
  listDeckSlides,
  parseDeckStructure,
  readDeckCharacterSlice,
  readDeckHtmlSlice,
  readDeckSlideHtml,
} from './deck-html.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import { compactVersionDiffForAgent, compactVersionProvenanceForAgent } from './deck-provenance.ts'
import { truncateDeckVersionSummary } from '@ark/contracts'
import type { Logger } from './observability/logger.ts'
import type { DeckVersionSummary } from './deck-record.ts'
import { type DeckWorkspace, setDeckWorkspaceHtml } from './deck-workspace.ts'

export type DeckVersionInspector = {
  listVersions: (limit?: number) => Promise<DeckVersionSummary[]>
}

const editSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .describe('Exact text to replace. Must appear exactly once in the deck.'),
  newText: z.string().describe('Replacement text.'),
})

function projectParsedDeck(parsed: ReturnType<typeof parseDeckStructure>) {
  return {
    title: parsed.title,
    structure: parsed.structure,
    runtime: parsed.runtime,
    slideSelector: parsed.slideSelector,
    slideCount: parsed.slideCount,
    slides: parsed.slides.map((slide) => ({
      index: slide.index,
      slideId: slide.slideId,
      slideIdTransient: slide.slideIdTransient,
      title: slide.title,
      preview: slide.preview,
      notes: slide.notes,
    })),
    editableElements: parsed.editableElements.map((group) => ({
      slideIndex: group.slideIndex,
      slideId: group.slideId,
      slideIdTransient: group.slideIdTransient,
      elements: group.elements,
    })),
    styles: parsed.styles.map((style) => ({
      index: style.index,
      inline: style.inline,
      href: style.href,
      media: style.media,
      contentLength: style.content.length,
    })),
    scripts: parsed.scripts,
    assets: parsed.assets,
  }
}

export function createDeckTools(
  workspace: DeckWorkspace,
  options: { logger?: Logger; versionInspector?: DeckVersionInspector } = {},
) {
  const { logger, versionInspector } = options
  const timingOptions = logger ? { logger } : {}
  const baseTools = {
    parse_deck: tool({
      description:
        'Parse the deck into structured metadata: title, runtime, slides, notes, styles, scripts, and asset references. Use before edits to understand deck shape.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!workspace.html.trim()) {
          return {
            error: 'No deck HTML is loaded yet. Use write_deck to create one.',
          }
        }

        const parsed = parseDeckStructure(workspace.html, timingOptions)

        return projectParsedDeck(parsed)
      },
    }),

    list_slides: tool({
      description:
        'List slide boundaries and titles in the current deck. Use before targeted edits.',
      inputSchema: z.object({}),
      execute: async () => {
        const slides = listDeckSlides(workspace.html)

        if (slides.length === 0) {
          return {
            slideCount: 0,
            slides: [],
            message:
              'No section.slide elements found. Use read_deck to inspect raw HTML structure.',
          }
        }

        return {
          slideCount: slides.length,
          slides,
        }
      },
    }),

    read_deck: tool({
      description:
        'Read deck HTML. Use offset/limit for line-based paging on large files, or slideIndex for one slide outerHTML.',
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based line number to start reading from.'),
        limit: z.number().int().min(1).optional().describe('Maximum number of lines to return.'),
        slideIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based slide index. When set, returns that slide HTML only.'),
        charOffset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Character offset for continuing one oversized line or slide.'),
      }),
      execute: async ({ offset, limit, slideIndex, charOffset }) => {
        if (!workspace.html.trim()) {
          return {
            error: 'No deck HTML is loaded yet. Use write_deck to create one.',
          }
        }

        if (slideIndex !== undefined) {
          const slide = readDeckSlideHtml(workspace.html, slideIndex, charOffset)

          if (!slide.ok) {
            return { error: slide.error }
          }

          const { ok: _ok, ...result } = slide
          return { mode: 'slide' as const, ...result }
        }

        const slice =
          charOffset !== undefined
            ? readDeckCharacterSlice(workspace.html, { offset, charOffset })
            : readDeckHtmlSlice(workspace.html, { offset, limit })

        return {
          mode: 'lines' as const,
          ...slice,
        }
      },
    }),

    write_deck: tool({
      description:
        'Replace the entire deck HTML. Use only for new decks or when the user explicitly asks for a full rewrite.',
      inputSchema: z.object({
        html: z.string().min(1).describe('Complete self-contained HTML document.'),
      }),
      execute: async ({ html }) => {
        const validation = validateDeckHtmlOnServer(html, timingOptions)

        if (!validation.valid) {
          const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

          return {
            ok: false,
            error: primaryIssue?.message ?? 'HTML failed Ark deck validation.',
            validation,
          }
        }

        setDeckWorkspaceHtml(workspace, html)

        return {
          ok: true,
          slideCount: validation.slideCount,
          message: `Wrote complete deck (${validation.slideCount} slide(s)).`,
        }
      },
    }),

    edit_deck: tool({
      description:
        'Apply exact search/replace patches to the deck. Each oldText must match exactly once in the original file. Prefer patch_deck for slide operations; use this for small inline HTML tweaks.',
      inputSchema: z.object({
        edits: z.array(editSchema).min(1).max(20),
      }),
      execute: async ({ edits }) => {
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

        setDeckWorkspaceHtml(workspace, applied.html)

        return {
          ok: true,
          appliedCount: applied.appliedCount,
          slideCount: validation.slideCount,
          message: `Applied ${applied.appliedCount} edit(s). Deck now has ${validation.slideCount} slide(s).`,
        }
      },
    }),

    patch_deck: tool({
      description:
        'Apply structured slide-level patch operations (add, delete, replace, reorder, title, notes). Prefer this over edit_deck or write_deck for slide changes. Call list_slides or parse_deck first to get indexes and slide ids.',
      inputSchema: z.object({
        operations: z.array(deckSlidePatchOperationSchema).min(1).max(20),
        activeSlideIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Current active slide index when reordering or deleting slides.'),
      }),
      execute: async ({ operations, activeSlideIndex }) => {
        if (!workspace.html.trim()) {
          return {
            ok: false,
            error: 'No deck HTML is loaded yet. Use write_deck to create one first.',
          }
        }

        const { applyDeckPatches } = await import('./deck-patch.ts')
        const patched = applyDeckPatches(workspace.html, operations, { activeSlideIndex })

        if (!patched.ok) {
          return { ok: false, error: patched.error, operationIndex: patched.operationIndex }
        }

        const validation = validateDeckHtmlOnServer(patched.html, timingOptions)

        if (!validation.valid) {
          const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

          return {
            ok: false,
            error:
              primaryIssue?.message ??
              'Applied patches produced invalid deck HTML. Fix the operation and try again.',
            validation,
            operationIndex: patched.appliedCount,
          }
        }

        setDeckWorkspaceHtml(workspace, patched.html)

        return {
          ok: true,
          appliedCount: patched.appliedCount,
          slideCount: validation.slideCount,
          changedSlideIndexes: patched.changedSlideIndexes,
          suggestedActiveSlideIndex: patched.suggestedActiveSlideIndex,
          summary: patched.summary,
          message: patched.summary,
        }
      },
    }),

    patch_element: tool({
      description:
        'Apply element-level patch operations targeting elements by id (replace_text, set_attrs, set_inline_style, move_element, resize_element, reorder_element, duplicate_element, delete_element, insert_element, lock_element, unlock_element). Use this to edit the element the user selected. Call parse_deck first to get element ids, kinds, and locked/managed flags. Locked elements cannot be changed.',
      inputSchema: z.object({
        operations: z.array(deckElementPatchOperationSchema).min(1).max(20),
        activeSlideIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Current active slide index for context.'),
      }),
      execute: async ({ operations, activeSlideIndex }) => {
        if (!workspace.html.trim()) {
          return {
            ok: false,
            error: 'No deck HTML is loaded yet. Use write_deck to create one first.',
          }
        }

        const { applyDeckPatches } = await import('./deck-patch.ts')
        const patched = applyDeckPatches(workspace.html, operations, { activeSlideIndex })

        if (!patched.ok) {
          return { ok: false, error: patched.error, operationIndex: patched.operationIndex }
        }

        const validation = validateDeckHtmlOnServer(patched.html, timingOptions)

        if (!validation.valid) {
          const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

          return {
            ok: false,
            error:
              primaryIssue?.message ??
              'Applied element patches produced invalid deck HTML. Fix the operation and try again.',
            validation,
            operationIndex: patched.appliedCount,
          }
        }

        setDeckWorkspaceHtml(workspace, patched.html)

        return {
          ok: true,
          appliedCount: patched.appliedCount,
          slideCount: validation.slideCount,
          changedSlideIndexes: patched.changedSlideIndexes,
          changedElementIds: patched.changedElementIds,
          summary: patched.summary,
          message: patched.summary,
        }
      },
    }),
  }

  if (!versionInspector) {
    return baseTools
  }

  return {
    ...baseTools,
    list_versions: tool({
      description:
        'List recent deck versions with source, summary, model, structural diff, and compact provenance metadata. Never returns full HTML snapshots.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum versions to return (default 10, max 20).'),
      }),
      execute: async ({ limit = 10 }) => {
        const versions = await versionInspector.listVersions(Math.min(limit, 20))

        return {
          versionCount: versions.length,
          versions: versions.map((version) => ({
            versionNumber: version.versionNumber,
            source: version.source,
            summary:
              typeof version.summary === 'string'
                ? truncateDeckVersionSummary(version.summary)
                : version.summary,
            createdAt: version.createdAt,
            validationStatus: version.validationStatus,
            modelName: version.modelName ?? null,
            diff: compactVersionDiffForAgent(version.diff),
            provenance: compactVersionProvenanceForAgent(version.provenance),
          })),
        }
      },
    }),
  }
}

export type DeckTools = ReturnType<typeof createDeckTools>
