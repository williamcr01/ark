import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { applyDeckPatches } from '@ark/deck/patch/slide-ops.ts'
import { parseDeckHtml } from '@ark/deck-node/document/parser.ts'
import { validateDeckHtmlOnServer } from '@ark/deck/validate/timed.ts'
import { createLogger, type StructuredLogEntry } from '@ark/telemetry/logger.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')
const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')

function createCapturingLogger() {
  const entries: StructuredLogEntry[] = []
  const logger = createLogger({
    write: (entry) => entries.push(entry),
  })

  return { entries, logger }
}

describe('deck operation observability', () => {
  it('logs deck.parse.completed when a logger is provided', () => {
    const { entries, logger } = createCapturingLogger()

    const parsed = parseDeckHtml(plainCssDeck, { logger })

    expect(parsed.slideCount).toBeGreaterThan(0)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'deck.parse.completed',
      durationMs: expect.any(Number),
      fields: {
        htmlBytes: expect.any(Number),
        slideCount: parsed.slideCount,
        structure: parsed.structure,
        scriptCount: expect.any(Number),
        assetCount: expect.any(Number),
      },
    })
  })

  it('logs deck.validation.completed when a logger is provided', () => {
    const { entries, logger } = createCapturingLogger()

    const validation = validateDeckHtmlOnServer(plainCssDeck, { logger })

    expect(validation.valid).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'deck.validation.completed',
      durationMs: expect.any(Number),
      fields: {
        htmlBytes: expect.any(Number),
        valid: true,
        issueCount: 0,
      },
    })
  })

  it('logs reused live-DOM validation when applying a patch', () => {
    const { entries, logger } = createCapturingLogger()

    const patched = applyDeckPatches(
      plainCssDeck,
      [{ op: 'update_slide_title', slideIndex: 0, title: 'Planning' }],
      { logger },
    )

    expect(patched.ok).toBe(true)
    if (!patched.ok) return
    expect(patched.validation?.valid).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'deck.validation.completed',
      durationMs: expect.any(Number),
      fields: {
        htmlBytes: expect.any(Number),
        valid: true,
        issueCount: 0,
      },
    })
  })

  it('does not log when no logger is provided', () => {
    const { entries, logger } = createCapturingLogger()

    parseDeckHtml(plainCssDeck)
    validateDeckHtmlOnServer(plainCssDeck)

    expect(entries).toHaveLength(0)
    expect(logger).toBeDefined()
  })
})
