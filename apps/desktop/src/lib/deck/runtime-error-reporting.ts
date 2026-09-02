import { reportRuntimeError, type ReportRuntimeErrorInput } from '@/lib/api/runtime-error-api'
import type { DeckRuntimeMode } from '@/lib/deck/deck-runtime'
import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'

export const MAX_RUNTIME_ERROR_REPORTS_PER_DECK_VERSION = 20
export const MAX_RUNTIME_ERROR_MESSAGE_LENGTH = 2_000
export const MAX_RUNTIME_ERROR_SOURCE_LENGTH = 500
export const MAX_RUNTIME_ERROR_SUMMARY_LENGTH = 500

export type RuntimeErrorNotice = {
  deckId: string | null
  message: string
  slideIndex: number
  documentRevision: number | null
}

export type RuntimeErrorRepairContext = {
  runtimeMode: DeckRuntimeMode
  previewMode: DeckRuntimeManifest['previewMode']
  approvedRuntime: DeckRuntimeManifest['approvedRuntime']
  validationValid: boolean
  validationErrors: DeckRuntimeManifest['validation']['errors']
  validationWarnings: DeckRuntimeManifest['validation']['warnings']
  relatedJobId?: string | null
}

export function fingerprintRuntimeError(message: string, source: string | null) {
  return `${message.slice(0, MAX_RUNTIME_ERROR_SUMMARY_LENGTH)}:${source ?? ''}`
}

export function normalizeRuntimeErrorReport(rawMessage: string, rawSource?: string | null) {
  const message = rawMessage.trim().slice(0, MAX_RUNTIME_ERROR_MESSAGE_LENGTH)
  const source = rawSource?.trim().slice(0, MAX_RUNTIME_ERROR_SOURCE_LENGTH) || null
  return { message, source }
}

export function shouldReportRuntimeError(
  reported: Set<string>,
  fingerprint: string,
  isNavigationGuard: boolean,
) {
  if (reported.has(fingerprint)) {
    return false
  }

  return isNavigationGuard || reported.size < MAX_RUNTIME_ERROR_REPORTS_PER_DECK_VERSION
}

export function buildRuntimeErrorInput(
  notice: Omit<RuntimeErrorNotice, 'message'> & { message: string; source: string | null },
  repair: RuntimeErrorRepairContext,
): ReportRuntimeErrorInput {
  return {
    deckId: notice.deckId,
    documentRevision: notice.documentRevision,
    slideIndex: notice.slideIndex,
    severity: 'error',
    message: notice.message,
    source: notice.source,
    repairContext: {
      errorSummary: notice.message.slice(0, MAX_RUNTIME_ERROR_SUMMARY_LENGTH),
      affectedSlideIndex: notice.slideIndex,
      runtime: {
        mode: repair.runtimeMode,
        previewMode: repair.previewMode,
        approvedRuntime: repair.approvedRuntime ?? null,
      },
      validation: {
        status: repair.validationValid ? 'valid' : 'invalid',
        errors: repair.validationErrors,
        warnings: repair.validationWarnings,
      },
      relatedJobId: repair.relatedJobId ?? null,
      documentRevision: notice.documentRevision,
    },
  }
}

export function compromiseReasonMessage(reason: string) {
  if (reason === 'unexpected-load') {
    return 'Preview stopped: the deck attempted an unexpected navigation away from the sandbox render URL.'
  }

  if (reason === 'invalid-handshake') {
    return 'Preview stopped: the preview frame sent an invalid security handshake.'
  }

  return 'Preview stopped: the preview frame never completed its security handshake with Ark.'
}

export function reportCapturedRuntimeError(
  reported: Set<string>,
  fingerprint: string,
  input: ReportRuntimeErrorInput,
) {
  void reportRuntimeError(input).catch(() => {
    reported.delete(fingerprint)
  })
}
