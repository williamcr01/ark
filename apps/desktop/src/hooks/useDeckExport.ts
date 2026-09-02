import { useCallback } from 'react'
import { toast } from 'sonner'

import type { DeckExportFormat } from '@/lib/deck/deck-export'
import { formatPptxExportWarning, lintDeckHtmlForExport } from '@/lib/deck/export-lint'
import { useShellStore } from '@/state/shell-store.ts'

import { useWorkspaceRuntimeContext } from './workspace-runtime-context'

export function useDeckExport() {
  const { persistence } = useWorkspaceRuntimeContext()
  const { deckId, deckTitle, html: generatedHtml } = persistence
  const exportingDeck = useShellStore((state) => state.exportingDeck)

  const handleExport = useCallback(
    async (format: DeckExportFormat) => {
      if (useShellStore.getState().exportingDeck || !deckId || !generatedHtml) return

      const label = format === 'pdf' ? 'PDF' : 'PowerPoint'
      useShellStore.getState().setExportingDeck(format)
      const pending = toast.loading(`Exporting ${label}...`)
      try {
        const result = await window.arkDesktop.export.create({
          format,
          html: generatedHtml,
          title: deckTitle,
        })
        if (result.ok) {
          const warning =
            format === 'pptx'
              ? formatPptxExportWarning(result.warning, lintDeckHtmlForExport(generatedHtml))
              : result.warning
          toast.success(warning ? `${label} exported - ${warning}` : `${label} exported`, {
            id: pending,
          })
        } else if (result.canceled) {
          toast.dismiss(pending)
        } else {
          toast.error(result.error ?? 'Could not export deck.', { id: pending })
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not export deck.', {
          id: pending,
        })
      } finally {
        useShellStore.getState().setExportingDeck(false)
      }
    },
    [deckId, deckTitle, generatedHtml],
  )

  return { handleExport, exportingDeck }
}
