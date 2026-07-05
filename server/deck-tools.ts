import { tool } from 'ai'
import { z } from 'zod'

import { deckSlidePatchOperationSchema } from '../shared/deck-patch.ts'
import { applyDeckEdits } from './deck-edit.ts'
import {
  listDeckSlides,
  parseDeckStructure,
  readDeckHtmlSlice,
  readDeckSlideHtml,
} from './deck-html.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import { type DeckWorkspace, setDeckWorkspaceHtml } from './deck-workspace.ts'

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
      title: slide.title,
      preview: slide.preview,
      notes: slide.notes,
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

export function createDeckTools(workspace: DeckWorkspace) {
  return {
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

        const parsed = parseDeckStructure(workspace.html)

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
      }),
      execute: async ({ offset, limit, slideIndex }) => {
        if (!workspace.html.trim()) {
          return {
            error: 'No deck HTML is loaded yet. Use write_deck to create one.',
          }
        }

        if (slideIndex !== undefined) {
          const slide = readDeckSlideHtml(workspace.html, slideIndex)

          if (!slide.ok) {
            return { error: slide.error }
          }

          return {
            mode: 'slide' as const,
            index: slide.index,
            title: slide.title,
            content: slide.content,
            notes: slide.notes,
          }
        }

        const slice = readDeckHtmlSlice(workspace.html, { offset, limit })

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
        const validation = validateDeckHtmlOnServer(html)

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

        const validation = validateDeckHtmlOnServer(applied.html)

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

        const validation = validateDeckHtmlOnServer(patched.html)

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
  }
}

export type DeckTools = ReturnType<typeof createDeckTools>
