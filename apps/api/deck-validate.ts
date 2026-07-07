import { JSDOM } from 'jsdom'

import { validateDeckHtml, type DeckValidationReport } from '@ark/deck-core/deck-validate.ts'
import type { Logger } from './observability/logger.ts'
import { logTimedEvent, measureSync } from './observability/timing.ts'

export type { DeckValidationReport }

export type DeckValidationOptions = {
  logger?: Logger
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
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      valid: result.valid,
      issueCount: result.issues.length,
    })
  }

  return result
}
