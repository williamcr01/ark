/**
 * Validation and filename derivation for export requests crossing the IPC
 * boundary. Kept free of Electron and pdf-lib so both halves are directly
 * testable.
 */

import type { DeckExportFormat, DeckExportRequest } from './deck-export.ts'

const EXPORT_FORMATS = new Set<DeckExportFormat>(['pdf'])

/** Generous, but bounded: a deck this large is a bug, not a presentation. */
const MAX_DECK_HTML_LENGTH = 20_000_000
const MAX_DECK_TITLE_LENGTH = 1_000
/** Leaves room for the extension and a de-duplicating suffix on every platform. */
const MAX_FILE_STEM_LENGTH = 120

const FALLBACK_FILE_STEM = 'Untitled Presentation'
/** Reserved on Windows whatever the extension, and harmless to avoid elsewhere. */
const RESERVED_STEMS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function parseDeckExportRequest(value: unknown): DeckExportRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid export request.')
  const request = value as Record<string, unknown>

  if (
    typeof request.format !== 'string' ||
    !EXPORT_FORMATS.has(request.format as DeckExportFormat)
  ) {
    throw new Error('Unsupported export format.')
  }
  if (typeof request.html !== 'string' || !request.html.trim()) {
    throw new Error('This deck has no content to export.')
  }
  if (request.html.length > MAX_DECK_HTML_LENGTH) {
    throw new Error('This deck is too large to export.')
  }
  if (typeof request.title !== 'string' || request.title.length > MAX_DECK_TITLE_LENGTH) {
    throw new Error('Invalid deck title.')
  }

  return {
    format: request.format as DeckExportFormat,
    html: request.html,
    title: request.title,
  }
}

/**
 * Turn a deck title into a filename the save dialog can open on any platform.
 *
 * Control characters and the Windows-reserved set become spaces, runs of
 * whitespace collapse, and leading/trailing dots and spaces go - Windows
 * silently rewrites names that end in either.
 */
export function toExportFileStem(title: string) {
  const stem = Array.from(title, (character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f ? ' ' : character
  })
    .join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_FILE_STEM_LENGTH)
    .replace(/[\s.]+$/, '')

  if (!stem || RESERVED_STEMS.test(stem)) return FALLBACK_FILE_STEM
  return stem
}

export function exportFileName(title: string, format: DeckExportFormat) {
  return `${toExportFileStem(title)}.${format}`
}

export function exportDialogFilter(format: DeckExportFormat) {
  return { name: 'PDF Document', extensions: [format] }
}
