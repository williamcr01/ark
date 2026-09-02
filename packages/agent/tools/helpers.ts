import type { DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import { evaluateDeckThemeMatch } from '@ark/deck-node/document/theme-html.ts'
import { parseDeckStructure } from '../document.ts'
import type { DeckValidationReport } from '@ark/deck-node/validate/timed.ts'

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

export function collectValidationWarnings(validation: DeckValidationReport) {
  return validation.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message)
}

export function appendWarnings(message: string, warnings: string[]) {
  return warnings.length > 0 ? `${message} Fix before finishing: ${warnings.join(' ')}` : message
}

export function projectParsedDeck(parsed: ReturnType<typeof parseDeckStructure>) {
  return {
    title: parsed.title,
    structure: parsed.structure,
    runtime: parsed.runtime,
    slideSelector: parsed.slideSelector,
    slideCount: parsed.slideCount,
    theme: parsed.theme,
    fonts: parsed.fonts,
    slides: parsed.slides.map((slide) => ({
      index: slide.index,
      slideId: slide.slideId,
      slideIdTransient: slide.slideIdTransient,
      title: slide.title,
      preview: slide.preview,
      notes: slide.notes,
      kind: slide.kind,
      layout: slide.layout,
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

export function rejectThemeMismatch(
  html: string,
  expectedTheme: DeckThemeSpecV1 | null | undefined,
) {
  if (!expectedTheme) return null
  const issues = evaluateDeckThemeMatch(html, expectedTheme)
  if (issues.length === 0) return null
  return {
    ok: false as const,
    error: `Deck does not match the selected theme: ${issues.map((issue) => issue.message).join(' ')}`,
    themeIssues: issues,
  }
}
