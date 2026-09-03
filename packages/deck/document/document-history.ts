/** Bounded document snapshots stored inside an `.ark` workspace (issue #299). */

import { z } from 'zod'

/**
 * Who committed the document snapshot. Session undo (#305) uses a finer
 * in-memory stack; this is the durable source tag on disk.
 *
 * - `editor` — manual patch / HTML replace from the shell
 * - `agent` — generation job write (one row per completed turn)
 * - `mcp` — MCP tool write
 * - `import` — reserved for HTML import when the writer tags it
 * - `create` — initial document, including files backfilled on migrate
 * - `restore` — current document was reset from an older history row
 */
export const DOCUMENT_HISTORY_SOURCES = [
  'editor',
  'agent',
  'mcp',
  'import',
  'create',
  'restore',
] as const

export type DocumentHistorySource = (typeof DOCUMENT_HISTORY_SOURCES)[number]

export const documentHistorySourceSchema = z.enum(DOCUMENT_HISTORY_SOURCES)

export const DEFAULT_DOCUMENT_HISTORY_SOURCE: DocumentHistorySource = 'editor'

export function isDocumentHistorySource(value: unknown): value is DocumentHistorySource {
  return (
    typeof value === 'string' && (DOCUMENT_HISTORY_SOURCES as readonly string[]).includes(value)
  )
}

export function normalizeDocumentHistorySource(value: unknown): DocumentHistorySource {
  return isDocumentHistorySource(value) ? value : DEFAULT_DOCUMENT_HISTORY_SOURCE
}

/** Last N snapshots. Oldest rows are deleted first. */
export const DOCUMENT_HISTORY_MAX_ENTRIES = 50

/** Total UTF-8 bytes of stored HTML across history rows. */
export const DOCUMENT_HISTORY_MAX_BYTES = 8 * 1024 * 1024

export const DEFAULT_DOCUMENT_HISTORY_LIMITS = {
  maxEntries: DOCUMENT_HISTORY_MAX_ENTRIES,
  maxBytes: DOCUMENT_HISTORY_MAX_BYTES,
} as const

export type DocumentHistoryLimits = {
  maxEntries: number
  maxBytes: number
}

export const documentHistorySummarySchema = z.object({
  revision: z.number().int().min(1),
  source: documentHistorySourceSchema,
  createdAt: z.string(),
  byteSize: z.number().int().min(0),
})

export type DocumentHistorySummary = z.infer<typeof documentHistorySummarySchema>
