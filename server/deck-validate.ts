import { JSDOM } from 'jsdom'

import { validateDeckHtml, type DeckValidationReport } from '../shared/deck-validate.ts'

export type { DeckValidationReport }

export function validateDeckHtmlOnServer(html: string): DeckValidationReport {
  return validateDeckHtml(html, (source) => new JSDOM(source).window.document)
}
