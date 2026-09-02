import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buildRuntimeErrorInput,
  fingerprintRuntimeError,
  normalizeRuntimeErrorReport,
  reportCapturedRuntimeError,
  shouldReportRuntimeError,
  type RuntimeErrorNotice,
} from '@/lib/deck/runtime-error-reporting.ts'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'

export function useDeckPreviewRuntimeError(
  analysis: DeckBrowserAnalysis,
  args: {
    deckId: string | null
    documentRevision: number | null
    recentGenerationJobId: string | null
    activeSlideIndexRef: { current: number }
    iframeKey: string
  },
) {
  const reportedRuntimeErrorsRef = useRef(new Set<string>())
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorNotice | null>(null)
  const runtimeManifest = analysis.runtimeManifest
  const { deckId, documentRevision, recentGenerationJobId, activeSlideIndexRef, iframeKey } = args

  const captureRuntimeError = useCallback(
    (rawMessage: string, rawSource?: string | null, showNotice = true) => {
      const { message, source: errorSource } = normalizeRuntimeErrorReport(rawMessage, rawSource)
      if (!message) {
        return
      }

      const fingerprint = fingerprintRuntimeError(message, errorSource)
      const isNavigationGuard = errorSource === 'preview-navigation-guard'
      if (
        !shouldReportRuntimeError(reportedRuntimeErrorsRef.current, fingerprint, isNavigationGuard)
      ) {
        return
      }

      reportedRuntimeErrorsRef.current.add(fingerprint)
      const slideIndex = activeSlideIndexRef.current
      if (showNotice) {
        setRuntimeError({ deckId, message, slideIndex, documentRevision })
      }

      reportCapturedRuntimeError(
        reportedRuntimeErrorsRef.current,
        fingerprint,
        buildRuntimeErrorInput(
          { deckId, documentRevision, slideIndex, message, source: errorSource },
          {
            runtimeMode: runtimeManifest.runtimeMode,
            previewMode: runtimeManifest.previewMode,
            approvedRuntime: runtimeManifest.approvedRuntime,
            validationValid: analysis.validation.valid,
            validationErrors: runtimeManifest.validation.errors,
            validationWarnings: runtimeManifest.validation.warnings,
            relatedJobId: recentGenerationJobId,
          },
        ),
      )
    },
    [
      activeSlideIndexRef,
      analysis.validation.valid,
      deckId,
      documentRevision,
      recentGenerationJobId,
      runtimeManifest.approvedRuntime,
      runtimeManifest.previewMode,
      runtimeManifest.runtimeMode,
      runtimeManifest.validation.errors,
      runtimeManifest.validation.warnings,
    ],
  )

  useEffect(() => {
    for (const fingerprint of reportedRuntimeErrorsRef.current) {
      if (fingerprint.endsWith(':preview-navigation-guard')) {
        reportedRuntimeErrorsRef.current.delete(fingerprint)
      }
    }
  }, [iframeKey])

  useEffect(() => {
    reportedRuntimeErrorsRef.current.clear()
  }, [deckId, documentRevision])

  return { captureRuntimeError, runtimeError, setRuntimeError }
}
