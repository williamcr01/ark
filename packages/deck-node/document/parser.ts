import { JSDOM } from 'jsdom'

import {
  EMPTY_DECK_PARSE_RESULT,
  parseDeckDocument,
  type DeckParseResult,
} from '@ark/deck/document/parser.ts'
import { utf8ByteLength } from '@ark/deck/document/utf8.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import { logTimedEvent, measureSync } from '@ark/telemetry/timing.ts'

export type { DeckParseResult }

export type DeckParseOptions = {
  logger?: Logger
}

export function parseDeckHtml(html: string, options: DeckParseOptions = {}): DeckParseResult {
  if (!html.trim()) {
    return EMPTY_DECK_PARSE_RESULT
  }

  const { result, durationMs } = measureSync(() =>
    parseDeckDocument(new JSDOM(html).window.document, html),
  )

  if (options.logger) {
    logTimedEvent(options.logger, 'deck.parse.completed', durationMs, {
      htmlBytes: utf8ByteLength(html),
      slideCount: result.slideCount,
      structure: result.structure,
      scriptCount: result.scripts.length,
      assetCount: result.assets.length,
    })
  }

  return result
}
