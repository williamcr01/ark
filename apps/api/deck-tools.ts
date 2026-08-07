import { tool } from 'ai'
import { z } from 'zod'

import { agentQuestionRequestSchema } from '@ark/deck-core/agent-questions.ts'
import { themeProposalRequestSchema } from '@ark/deck-core/agent-themes.ts'
import { applyDeckEdits } from './deck-edit.ts'
import {
  deckEditInputSchema,
  deckElementPatchInputSchema,
  deckReadInputSchema,
  deckSlidePatchInputSchema,
  deckWriteInputSchema,
} from '@ark/deck-core/mcp-tool-catalog.ts'
import {
  listDeckSlides,
  parseDeckStructure,
  readDeckCharacterSlice,
  readDeckHtmlSlice,
  readDeckSlideHtml,
} from './deck-html.ts'
import { validateDeckHtmlOnServer, type DeckValidationReport } from './deck-validate.ts'
import type { Logger } from './observability/logger.ts'
import { type DeckWorkspace, setDeckWorkspaceHtml } from './deck-workspace.ts'

export type DeckAttachmentSummary = {
  id: string
  filename: string
  mediaType: string
  byteSize: number
  url: string
}

export type DeckAttachmentInspector = {
  attachments: readonly DeckAttachmentSummary[]
  read: (id: string) => Promise<Buffer | null>
}

/**
 * Warnings never block a write, so the agent only learns about them if the tool
 * result carries them back (e.g. scripts that preview will strip).
 */
function collectValidationWarnings(validation: DeckValidationReport) {
  return validation.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message)
}

function appendWarnings(message: string, warnings: string[]) {
  return warnings.length > 0 ? `${message} Fix before finishing: ${warnings.join(' ')}` : message
}

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
  options: {
    logger?: Logger
    attachmentInspector?: DeckAttachmentInspector
  } = {},
) {
  const { logger, attachmentInspector } = options
  const timingOptions = logger ? { logger } : {}
  const baseTools = {
    parse_deck: tool({
      description:
        'Parse the deck into structured metadata: title, runtime, slides, notes, styles, scripts, asset references, and editable element ids. Use before edits to understand deck shape.',
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
        'Read deck HTML. Use offset/limit for line-based paging on large files, or slideIndex for one slide outerHTML. Re-read when transcript markers say content was omitted.',
      inputSchema: deckReadInputSchema,
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
      inputSchema: deckWriteInputSchema,
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

        const warnings = collectValidationWarnings(validation)

        return {
          ok: true,
          slideCount: validation.slideCount,
          warnings,
          message: appendWarnings(
            `Wrote complete deck (${validation.slideCount} slide(s)).`,
            warnings,
          ),
        }
      },
    }),

    edit_deck: tool({
      description:
        'Apply exact search/replace patches to the deck. Each oldText must match exactly once in the original file. Prefer patch_deck for slide operations; use this for small inline HTML tweaks.',
      inputSchema: deckEditInputSchema,
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
      },
    }),

    patch_deck: tool({
      description:
        'Apply structured slide-level patch operations (add, delete, replace, reorder, title, notes). Prefer this over edit_deck or write_deck for slide changes. Call list_slides or parse_deck first to get indexes and slide ids.',
      inputSchema: deckSlidePatchInputSchema,
      execute: async ({ operations, activeSlideIndex }) => {
        if (!workspace.html.trim()) {
          return {
            ok: false,
            error: 'No deck HTML is loaded yet. Use write_deck to create one first.',
          }
        }

        const { applyDeckPatches } = await import('./deck-patch.ts')
        const patched = applyDeckPatches(workspace.html, operations, { activeSlideIndex, logger })

        if (!patched.ok) {
          return { ok: false, error: patched.error, operationIndex: patched.operationIndex }
        }

        const validation =
          patched.validation ?? validateDeckHtmlOnServer(patched.html, timingOptions)

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

        const warnings = collectValidationWarnings(validation)

        return {
          ok: true,
          appliedCount: patched.appliedCount,
          slideCount: validation.slideCount,
          changedSlideIndexes: patched.changedSlideIndexes,
          suggestedActiveSlideIndex: patched.suggestedActiveSlideIndex,
          summary: patched.summary,
          warnings,
          message: appendWarnings(patched.summary, warnings),
        }
      },
    }),

    patch_element: tool({
      description:
        'Apply element-level patch operations targeting elements by id (replace_text, set_attrs, set_inline_style, move_element, resize_element, reorder_element, duplicate_element, delete_element, insert_element, lock_element, unlock_element). Prefer this for the element the user selected. Call parse_deck first to get element ids, kinds, and locked/managed flags. Locked elements cannot be changed. If a selected element id is missing (stale) or locked, inspect the deck and pick the closest match or explain what can and cannot change instead of failing.',
      inputSchema: deckElementPatchInputSchema,
      execute: async ({ operations, activeSlideIndex }) => {
        if (!workspace.html.trim()) {
          return {
            ok: false,
            error: 'No deck HTML is loaded yet. Use write_deck to create one first.',
          }
        }

        const { applyDeckPatches } = await import('./deck-patch.ts')
        const patched = applyDeckPatches(workspace.html, operations, { activeSlideIndex, logger })

        if (!patched.ok) {
          return { ok: false, error: patched.error, operationIndex: patched.operationIndex }
        }

        const validation =
          patched.validation ?? validateDeckHtmlOnServer(patched.html, timingOptions)

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

        const warnings = collectValidationWarnings(validation)

        return {
          ok: true,
          appliedCount: patched.appliedCount,
          slideCount: validation.slideCount,
          changedSlideIndexes: patched.changedSlideIndexes,
          changedElementIds: patched.changedElementIds,
          summary: patched.summary,
          warnings,
          message: appendWarnings(patched.summary, warnings),
        }
      },
    }),
  }

  return {
    ...baseTools,
    ask_user: tool({
      description:
        'Ask the user up to five concise questions when critical context is missing. Supports single choice, multiple choice, and free text. Call this instead of guessing, then stop and wait for the next user message.',
      inputSchema: agentQuestionRequestSchema,
      execute: async ({ questions }) => ({
        ok: true,
        awaitingUserResponse: true,
        message: `Waiting for answers to ${questions.length} question(s).`,
      }),
    }),
    propose_themes: tool({
      description:
        'Propose exactly four visually distinct theme directions as single-slide sample HTML documents. Use before creating a new deck, or when the user explicitly asks to retheme the whole existing deck, then stop and wait for the user to pick one.',
      inputSchema: themeProposalRequestSchema,
      execute: async ({ themes }) => {
        for (const theme of themes) {
          const validation = validateDeckHtmlOnServer(theme.sampleHtml, timingOptions)
          if (!validation.valid) {
            const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
            return {
              ok: false,
              error: `Theme "${theme.name}" sampleHtml failed validation: ${primaryIssue?.message ?? 'invalid HTML'}`,
              themeId: theme.id,
            }
          }
        }

        return {
          ok: true,
          awaitingUserResponse: true,
          message: 'Waiting for the user to pick a theme.',
        }
      },
    }),
    // Always register attachment tools so the tool-schema prefix stays stable for
    // provider prompt caching. Return an error at call time when unavailable.
    list_attachments: tool({
      description:
        'List all files attached to this deck conversation. Use before reading reference material or placing attached images in the deck.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!attachmentInspector) {
          return { error: 'No attachments available for this conversation.' }
        }
        return {
          attachmentCount: attachmentInspector.attachments.length,
          attachments: attachmentInspector.attachments,
        }
      },
    }),
    read_attachment: tool({
      description:
        'Read a UTF-8 text, CSV, Markdown, or JSON attachment by byte offset. For binary files, returns metadata and the exact Ark URL to place in the deck; do not copy bytes or invent a URL.',
      inputSchema: z.object({
        id: z.string().describe('Attachment id from list_attachments.'),
        offset: z.number().int().min(0).optional().describe('UTF-8 byte offset.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(64 * 1024)
          .optional()
          .describe('Maximum bytes to return, up to 64 KiB.'),
      }),
      execute: async ({ id, offset = 0, limit = 32 * 1024 }) => {
        if (!attachmentInspector) {
          return { error: 'No attachments available for this conversation.' }
        }
        const attachment = attachmentInspector.attachments.find((item) => item.id === id)
        if (!attachment) return { error: 'Attachment not found.' }
        if (
          !attachment.mediaType.startsWith('text/') &&
          attachment.mediaType !== 'application/json'
        ) {
          return {
            ...attachment,
            binary: true,
            message: 'Binary attachment. Use this exact Ark URL when placing it in the deck.',
          }
        }
        const bytes = await attachmentInspector.read(id)
        if (!bytes) return { error: 'Attachment bytes are unavailable.' }
        const end = Math.min(bytes.length, offset + limit)
        return {
          ...attachment,
          offset,
          nextOffset: end < bytes.length ? end : undefined,
          content: bytes.subarray(offset, end).toString('utf8'),
        }
      },
    }),
  }
}

export type DeckTools = ReturnType<typeof createDeckTools>
