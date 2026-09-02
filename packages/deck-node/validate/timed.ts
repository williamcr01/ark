import { JSDOM } from 'jsdom'

import { utf8ByteLength } from '@ark/deck/document/utf8.ts'
import {
  validateDeckDocument,
  validateDeckHtml,
  type DeckValidationReport,
} from '@ark/deck/validate/document.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import { logTimedEvent, measureSync } from '@ark/telemetry/timing.ts'

export type { DeckValidationReport }

export type DeckValidationOptions = {
  logger?: Logger
}

export function validateDeckDocumentOnServer(
  doc: Document,
  html: string,
  options: DeckValidationOptions = {},
): DeckValidationReport {
  const { result, durationMs } = measureSync(() => validateDeckDocument(doc, html))

  if (options.logger) {
    logTimedEvent(options.logger, 'deck.validation.completed', durationMs, {
      htmlBytes: utf8ByteLength(html),
      valid: result.valid,
      issueCount: result.issues.length,
    })
  }

  return result
}

export function validateDeckHtmlOnServer(
  html: string,
  options: DeckValidationOptions = {},
): DeckValidationReport {
  const { result, durationMs } = measureSync(() =>
    validateDeckHtml(html, (source) => new JSDOM(source).window.document),
  )

  if (options.logger) {
    logTimedEvent(options.logger, 'deck.validation.completed', durationMs, {
      htmlBytes: utf8ByteLength(html),
      valid: result.valid,
      issueCount: result.issues.length,
    })
  }

  return result
}
