import { tool } from 'ai'
import { z } from 'zod'

import { deckReadInputSchema } from '../tool-schemas.ts'
import {
  listDeckSlides,
  parseDeckStructure,
  readDeckCharacterSlice,
  readDeckHtmlSlice,
  readDeckSlideHtml,
} from '../document.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import type { DeckWorkspace } from '../workspace.ts'
import { projectParsedDeck } from './helpers.ts'

export function createInspectDeckTools(
  workspace: DeckWorkspace,
  timingOptions: { logger?: Logger },
) {
  return {
    parse_deck: tool({
      description:
        'Parse the deck into structured metadata: title, runtime, theme, slides (including kind/layout), notes, styles, scripts, asset references, and editable element ids. Use before edits to understand deck shape.',
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
  }
}
