import { JSDOM } from 'jsdom'

import {
  validateDeckHtml,
  type DeckValidationReport,
} from '../src/lib/deck-validate.ts'

export function validateDeckHtmlOnServer(html: string): DeckValidationReport {
  return validateDeckHtml(html, (source) => new JSDOM(source).window.document)
}
