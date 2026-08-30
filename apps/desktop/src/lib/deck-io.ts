import { resolveDownloadHtml, type DeckDownloadVariant } from '@/lib/deck-export'
import {
  formatDeckValidationSummary,
  type DeckValidationReport,
} from '@ark/deck/validate/document.ts'
import { validateDeckHtmlInBrowser } from './deck-validate.ts'

export type DownloadHtmlOptions = {
  variant?: DeckDownloadVariant
  baseName?: string
}

function toDownloadBaseName(baseName: string) {
  const sanitized = baseName
    // Intentionally strips control characters from filesystem names.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized || ''
}

export function downloadHtml(html: string, options: DownloadHtmlOptions = {}) {
  const variant = options.variant ?? 'original'
  const content = resolveDownloadHtml(html, variant)
  const date = new Date().toISOString().slice(0, 10)
  const baseName = toDownloadBaseName(options.baseName ?? '') || `ark-presentation-${date}`
  const suffix = variant === 'sanitized' ? '-sanitized' : ''
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${baseName}${suffix}.html`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function isHtmlDeckFile(file: File) {
  return (
    file.type === 'text/html' ||
    file.name.toLowerCase().endsWith('.html') ||
    file.name.toLowerCase().endsWith('.htm')
  )
}

export function validateUploadedDeck(html: string): DeckValidationReport {
  return validateDeckHtmlInBrowser(html)
}

export function describeDeckValidation(report: DeckValidationReport) {
  const warnings = report.issues.filter((issue) => issue.severity === 'warning')

  if (warnings.length === 0) {
    return formatDeckValidationSummary(report)
  }

  return `${formatDeckValidationSummary(report)}. ${warnings.map((issue) => issue.message).join(' ')}`
}
