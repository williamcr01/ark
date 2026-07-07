import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'

import { validateDeckHtmlOnServer } from './deck-validate.ts'

export const extractHtmlDocument = (text: string) => {
  const withoutFence = text
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const doctypeIndex = withoutFence.search(/<!doctype html>/i)
  if (doctypeIndex >= 0) {
    return withoutFence.slice(doctypeIndex).trim()
  }

  const htmlIndex = withoutFence.search(/<html[\s>]/i)
  if (htmlIndex >= 0) {
    return `<!DOCTYPE html>\n${withoutFence.slice(htmlIndex).trim()}`
  }

  return withoutFence
}

export type FinalizeGeneratedDeckResult =
  | { ok: true; html: string; validation: DeckValidationReport }
  | { ok: false; error: string; validation: DeckValidationReport }

export function finalizeGeneratedDeck(modelText: string): FinalizeGeneratedDeckResult {
  const html = extractHtmlDocument(modelText)
  const validation = validateDeckHtmlOnServer(html)

  if (!validation.valid) {
    const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

    return {
      ok: false,
      validation,
      error:
        primaryIssue?.message ??
        'The model did not return a valid Ark HTML deck. Try again with a more specific prompt.',
    }
  }

  return { ok: true, html, validation }
}
