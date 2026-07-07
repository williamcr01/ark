import { validateDeckHtml, type DeckValidationReport } from '../../shared/deck-validate.ts'

export type { DeckValidationReport }

export function validateDeckHtmlInBrowser(html: string): DeckValidationReport {
  return validateDeckHtml(html, (source) => new DOMParser().parseFromString(source, 'text/html'))
}
